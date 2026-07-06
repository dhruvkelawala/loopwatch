use std::{
    collections::{HashMap, HashSet},
    error::Error,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use notify_rust::Notification;
use serde::Deserialize;
use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager,
};

pub const COCKPIT_WINDOW_LABEL: &str = "cockpit";
const PULSE_TRAY_ID: &str = "loopwatch-pulse";
const PULSE_POLL_INTERVAL: Duration = Duration::from_secs(2);
const ENGINE_FETCH_TIMEOUT: Duration = Duration::from_secs(2);
const NOTIFICATION_THROTTLE: Duration = Duration::from_secs(10 * 60);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EngineAlertingConfig {
    base_url: String,
    bearer_token: String,
}

impl EngineAlertingConfig {
    pub fn new(base_url: String, bearer_token: String) -> Self {
        Self {
            base_url,
            bearer_token,
        }
    }

    fn convergence_url(&self) -> String {
        format!(
            "{}/loopwatch/convergence",
            self.base_url.trim_end_matches('/')
        )
    }
}

pub struct LayeredAlertingState {
    tray: TrayIcon,
    last_intervention_session: Mutex<Option<String>>,
}

impl LayeredAlertingState {
    fn new(tray: TrayIcon) -> Self {
        Self {
            tray,
            last_intervention_session: Mutex::new(None),
        }
    }

    fn set_pulse(&self, pulse: &PulseAggregate) {
        if let Err(error) = self.tray.set_title(Some(pulse.title())) {
            eprintln!("[loopwatch] failed to update Pulse title: {error}");
        }
        if let Err(error) = self.tray.set_tooltip(Some(pulse.tooltip())) {
            eprintln!("[loopwatch] failed to update Pulse tooltip: {error}");
        }
    }

    fn set_offline(&self, detail: &str) {
        if let Err(error) = self.tray.set_title(Some("0 · …")) {
            eprintln!("[loopwatch] failed to update Pulse offline title: {error}");
        }
        if let Err(error) = self
            .tray
            .set_tooltip(Some(format!("Loopwatch Pulse: {detail}")))
        {
            eprintln!("[loopwatch] failed to update Pulse offline tooltip: {error}");
        }
    }

    fn remember_intervention_session(&self, session_id: &str) {
        let mut last = self
            .last_intervention_session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *last = Some(session_id.to_string());
    }

    pub fn last_intervention_session(&self) -> Option<String> {
        self.last_intervention_session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}

pub fn setup_layered_alerting(
    app: &mut App,
    engine_config: EngineAlertingConfig,
) -> Result<(), Box<dyn Error>> {
    let tray = build_pulse_tray(app)?;
    app.manage(LayeredAlertingState::new(tray));
    start_pulse_watcher(app.handle().clone(), engine_config);
    Ok(())
}

pub fn show_cockpit_for_session(app_handle: &AppHandle, session_id: Option<&str>) {
    let Some(window) = app_handle.get_webview_window(COCKPIT_WINDOW_LABEL) else {
        return;
    };

    if let Err(error) = window.show() {
        eprintln!("[loopwatch] failed to show Cockpit window: {error}");
    }
    if let Err(error) = window.set_focus() {
        eprintln!("[loopwatch] failed to focus Cockpit window: {error}");
    }

    if let Some(session_id) = session_id {
        let script = focus_session_script(session_id);
        if let Err(error) = window.eval(script) {
            eprintln!("[loopwatch] failed to deep-link Cockpit session: {error}");
        }
    }
}

fn build_pulse_tray(app: &mut App) -> tauri::Result<TrayIcon> {
    TrayIconBuilder::with_id(PULSE_TRAY_ID)
        .icon(pulse_icon())
        .icon_as_template(true)
        .title("0 · …")
        .tooltip("Loopwatch Pulse: checking convergence state")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if !is_primary_tray_activation(&event) {
                return;
            }
            let app_handle = tray.app_handle().clone();
            let session_id = app_handle
                .state::<LayeredAlertingState>()
                .last_intervention_session();
            show_cockpit_for_session(&app_handle, session_id.as_deref());
        })
        .build(app)
}

fn is_primary_tray_activation(event: &TrayIconEvent) -> bool {
    matches!(
        event,
        TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        }
    )
}

fn start_pulse_watcher(app_handle: AppHandle, engine_config: EngineAlertingConfig) {
    thread::spawn(move || {
        let agent = ureq::Agent::config_builder()
            .timeout_per_call(Some(ENGINE_FETCH_TIMEOUT))
            .build()
            .new_agent();
        let mut memory = NotificationMemory::default();

        loop {
            match fetch_convergence(&agent, &engine_config) {
                Ok(payload) => {
                    let pulse = aggregate_pulse(&payload.sessions);
                    app_handle.state::<LayeredAlertingState>().set_pulse(&pulse);
                    let visible = cockpit_is_visible(&app_handle);
                    let notices = notification_candidates(&payload.sessions);
                    if let Some(notice) = notices.first() {
                        app_handle
                            .state::<LayeredAlertingState>()
                            .remember_intervention_session(&notice.session_id);
                    }
                    let due = due_notifications_for_visibility(
                        &mut memory,
                        &notices,
                        Instant::now(),
                        NOTIFICATION_THROTTLE,
                        visible,
                    );
                    if !due.is_empty() {
                        for notice in due {
                            app_handle
                                .state::<LayeredAlertingState>()
                                .remember_intervention_session(&notice.session_id);
                            send_intervention_notification(app_handle.clone(), notice);
                        }
                    }
                }
                Err(error) => {
                    app_handle
                        .state::<LayeredAlertingState>()
                        .set_offline(&format!("watcher unavailable · {error}"));
                }
            }

            thread::sleep(PULSE_POLL_INTERVAL);
        }
    });
}

fn cockpit_is_visible(app_handle: &AppHandle) -> bool {
    app_handle
        .get_webview_window(COCKPIT_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

fn fetch_convergence(
    agent: &ureq::Agent,
    config: &EngineAlertingConfig,
) -> Result<ConvergencePayload, Box<dyn Error>> {
    let mut response = agent
        .get(config.convergence_url())
        .header("authorization", format!("Bearer {}", config.bearer_token))
        .call()?;
    let body = response.body_mut().read_to_string()?;
    Ok(serde_json::from_str(&body)?)
}

fn send_intervention_notification(app_handle: AppHandle, notice: InterventionNotice) {
    #[cfg(target_os = "macos")]
    {
        let identifier = app_handle.config().identifier.clone();
        let _ = notify_rust::set_application(if tauri::is_dev() {
            "com.apple.Terminal"
        } else {
            identifier.as_str()
        });
    }

    let summary = format!("Loopwatch intervention: {}", notice.title);
    let body = format!("{} · {}", notice.session_title, notice.detail);
    let mut notification = Notification::new();
    notification
        .summary(&summary)
        .body(&body)
        .appname("Loopwatch")
        .action("default", "Open Cockpit");
    let shown = notification.show();

    match shown {
        Ok(handle) => {
            thread::spawn(move || {
                let session_id = notice.session_id;
                handle.wait_for_action(|action| {
                    if action != "__closed" {
                        show_cockpit_for_session(&app_handle, Some(&session_id));
                    }
                });
            });
        }
        Err(error) => eprintln!("[loopwatch] failed to send intervention notification: {error}"),
    }
}

fn focus_session_script(session_id: &str) -> String {
    let session_id_json = serde_json::to_string(session_id).unwrap_or_else(|_| "\"\"".to_string());
    format!(
        "(() => {{ const sessionId = {session_id_json}; window.location.hash = `session=${{encodeURIComponent(sessionId)}}`; window.dispatchEvent(new CustomEvent('loopwatch:focus-session', {{ detail: {{ sessionId }} }})); }})();"
    )
}

fn pulse_icon() -> Image<'static> {
    // A small template dot. The title carries the Pulse text; the icon keeps the
    // tray item visible on platforms that require an image.
    let mut rgba = Vec::with_capacity(16 * 16 * 4);
    for y in 0..16 {
        for x in 0..16 {
            let dx = x as i32 - 8;
            let dy = y as i32 - 8;
            let alpha = if dx * dx + dy * dy <= 49 { 255 } else { 0 };
            rgba.extend_from_slice(&[255, 255, 255, alpha]);
        }
    }
    Image::new_owned(rgba, 16, 16)
}

#[derive(Debug, Deserialize)]
struct ConvergencePayload {
    sessions: Vec<PulseSession>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PulseSummary {
    #[serde(default)]
    goal: String,
}

/// Mirrors the engine's `SessionConvergenceState` (src/convergence.ts) — only
/// the fields Pulse needs. Extra payload fields are ignored; `summary` is
/// defaulted so a lean payload still deserializes.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PulseSession {
    id: String,
    #[serde(default)]
    summary: PulseSummary,
    status: String,
    liveness: String,
    evidence: Vec<PulseEvidence>,
}

impl PulseSession {
    /// Human-facing session title for notifications: the running-summary goal,
    /// falling back to the session id when no goal has been observed yet.
    fn display_title(&self) -> String {
        if self.summary.goal.trim().is_empty() {
            self.id.clone()
        } else {
            self.summary.goal.clone()
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PulseEvidence {
    event_id: String,
    severity: String,
    signal: String,
    title: String,
    detail: String,
    recommended_action: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PulseAggregate {
    pub active_sessions: usize,
    pub watch_sessions: usize,
    pub intervention_sessions: usize,
}

impl PulseAggregate {
    pub fn title(&self) -> String {
        if self.intervention_sessions > 0 {
            return format!("{} · ⚠{}", self.active_sessions, self.intervention_sessions);
        }
        if self.watch_sessions > 0 {
            return format!("{} · ◔{}", self.active_sessions, self.watch_sessions);
        }
        format!("{} · ✓", self.active_sessions)
    }

    fn tooltip(&self) -> String {
        format!(
            "Loopwatch Pulse: {} active · {} watch · {} intervention",
            self.active_sessions, self.watch_sessions, self.intervention_sessions
        )
    }
}

pub fn aggregate_pulse(sessions: &[PulseSession]) -> PulseAggregate {
    let active = sessions
        .iter()
        .filter(|session| session.liveness == "active");
    let mut pulse = PulseAggregate {
        active_sessions: 0,
        watch_sessions: 0,
        intervention_sessions: 0,
    };

    for session in active {
        pulse.active_sessions += 1;
        match session.status.as_str() {
            "intervention" => pulse.intervention_sessions += 1,
            "watch" => pulse.watch_sessions += 1,
            _ => {}
        }
    }

    pulse
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InterventionNotice {
    pub key: String,
    pub session_id: String,
    pub session_title: String,
    pub title: String,
    pub detail: String,
}

pub fn notification_candidates(sessions: &[PulseSession]) -> Vec<InterventionNotice> {
    sessions
        .iter()
        .filter(|session| session.liveness == "active" && session.status == "intervention")
        .flat_map(|session| {
            session
                .evidence
                .iter()
                .filter(|evidence| actionable_intervention_evidence(evidence))
                .map(|evidence| InterventionNotice {
                    key: format!("{}:{}:{}", session.id, evidence.event_id, evidence.signal),
                    session_id: session.id.clone(),
                    session_title: session.display_title(),
                    title: evidence.title.clone(),
                    detail: evidence.detail.clone(),
                })
        })
        .collect()
}

fn actionable_intervention_evidence(evidence: &PulseEvidence) -> bool {
    evidence.severity == "intervention"
        && evidence
            .recommended_action
            .as_deref()
            .map(str::trim)
            .is_some_and(|action| !action.is_empty())
}

#[derive(Default)]
pub struct NotificationMemory {
    notified_keys: HashSet<String>,
    last_by_session: HashMap<String, Instant>,
}

impl NotificationMemory {
    pub fn due_notifications(
        &mut self,
        notices: &[InterventionNotice],
        now: Instant,
        throttle: Duration,
    ) -> Vec<InterventionNotice> {
        let mut due = Vec::new();

        for notice in notices {
            if self.notified_keys.contains(&notice.key) {
                continue;
            }
            if self
                .last_by_session
                .get(&notice.session_id)
                .is_some_and(|last| now.duration_since(*last) < throttle)
            {
                continue;
            }

            self.notified_keys.insert(notice.key.clone());
            self.last_by_session.insert(notice.session_id.clone(), now);
            due.push(notice.clone());
        }

        due
    }
}

fn due_notifications_for_visibility(
    memory: &mut NotificationMemory,
    notices: &[InterventionNotice],
    now: Instant,
    throttle: Duration,
    cockpit_visible: bool,
) -> Vec<InterventionNotice> {
    if cockpit_visible {
        Vec::new()
    } else {
        memory.due_notifications(notices, now, throttle)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(
        id: &str,
        title: &str,
        status: &str,
        liveness: &str,
        evidence: Vec<PulseEvidence>,
    ) -> PulseSession {
        PulseSession {
            id: id.to_owned(),
            summary: PulseSummary { goal: title.to_owned() },
            status: status.to_owned(),
            liveness: liveness.to_owned(),
            evidence,
        }
    }

    fn evidence(
        event_id: &str,
        severity: &str,
        signal: &str,
        recommended_action: Option<&str>,
    ) -> PulseEvidence {
        PulseEvidence {
            event_id: event_id.to_owned(),
            severity: severity.to_owned(),
            signal: signal.to_owned(),
            title: format!("{event_id} title"),
            detail: format!("{event_id} detail"),
            recommended_action: recommended_action.map(str::to_owned),
        }
    }

    fn notice(session_id: &str, key: &str) -> InterventionNotice {
        InterventionNotice {
            key: key.to_owned(),
            session_id: session_id.to_owned(),
            session_title: format!("{session_id} title"),
            title: format!("{key} title"),
            detail: format!("{key} detail"),
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "sends a real macOS desktop notification"]
    fn macos_native_notification_smoke() -> Result<(), Box<dyn Error>> {
        notify_rust::set_application("com.apple.Terminal")?;

        let delivery_time = std::time::SystemTime::now()
            .checked_add(Duration::from_secs(1))
            .ok_or("notification delivery time overflowed")?
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs_f64();

        Notification::new()
            .summary("Loopwatch native notification smoke")
            .body("Loopwatch smoke test: macOS accepted this native desktop notification.")
            .schedule_raw(delivery_time)?;

        Ok(())
    }

    #[test]
    fn pulse_session_deserializes_real_engine_convergence_payload() {
        // Shape mirrors src/app.ts `c.json({ ok: true, ...snapshot })` with
        // src/convergence.ts `SessionConvergenceState` sessions — no `title`
        // field exists there, only `summary.goal`.
        let payload: ConvergencePayload = serde_json::from_str(
            r#"{
                "ok": true,
                "nextPollMs": 2000,
                "spend": {"judgeCalls": 0},
                "sessions": [{
                    "id": "claude:s1",
                    "source": "claude",
                    "sessionId": "s1",
                    "status": "intervention",
                    "liveness": "active",
                    "summary": {"goal": "ship the fix", "done": [], "validation": [], "concerns": []},
                    "evidence": [{
                        "eventId": "e1",
                        "severity": "intervention",
                        "signal": "completion_without_evidence",
                        "title": "Completion without evidence",
                        "detail": "claimed done with no validation",
                        "recommendedAction": "run the tests"
                    }],
                    "judge": {"lastJudgedEventCount": 0},
                    "spend": {"judgeCalls": 0},
                    "eventCount": 3,
                    "meaningfulEventCount": 2,
                    "lastEventAt": "2026-07-04T11:00:00.000Z"
                }]
            }"#,
        )
        .expect("engine convergence payload must deserialize");

        assert_eq!(payload.sessions.len(), 1);
        assert_eq!(payload.sessions[0].display_title(), "ship the fix");
        let notices = notification_candidates(&payload.sessions);
        assert_eq!(notices.len(), 1);
        assert_eq!(notices[0].session_title, "ship the fix");
    }

    #[test]
    fn aggregate_pulse_counts_active_sessions_and_titles_highest_active_state() {
        let cases = [
            (
                "active intervention outranks active watch",
                vec![
                    session("ready", "Ready", "ready", "active", vec![]),
                    session("watch", "Watch", "watch", "active", vec![]),
                    session(
                        "intervention",
                        "Intervention",
                        "intervention",
                        "active",
                        vec![],
                    ),
                    session("inactive-watch", "Inactive watch", "watch", "idle", vec![]),
                    session(
                        "inactive-intervention",
                        "Inactive intervention",
                        "intervention",
                        "idle",
                        vec![],
                    ),
                ],
                PulseAggregate {
                    active_sessions: 3,
                    watch_sessions: 1,
                    intervention_sessions: 1,
                },
                "3 · ⚠1",
            ),
            (
                "active watch is surfaced when no active intervention exists",
                vec![
                    session("ready", "Ready", "ready", "active", vec![]),
                    session("watch", "Watch", "watch", "active", vec![]),
                    session(
                        "inactive-intervention",
                        "Inactive intervention",
                        "intervention",
                        "idle",
                        vec![],
                    ),
                ],
                PulseAggregate {
                    active_sessions: 2,
                    watch_sessions: 1,
                    intervention_sessions: 0,
                },
                "2 · ◔1",
            ),
            (
                "healthy title ignores inactive concerns",
                vec![
                    session("ready", "Ready", "ready", "active", vec![]),
                    session("inactive-watch", "Inactive watch", "watch", "idle", vec![]),
                    session(
                        "inactive-intervention",
                        "Inactive intervention",
                        "intervention",
                        "idle",
                        vec![],
                    ),
                ],
                PulseAggregate {
                    active_sessions: 1,
                    watch_sessions: 0,
                    intervention_sessions: 0,
                },
                "1 · ✓",
            ),
        ];

        for (name, sessions, expected, expected_title) in cases {
            let pulse = aggregate_pulse(&sessions);

            assert_eq!(pulse, expected, "{name}");
            assert_eq!(pulse.title(), expected_title, "{name}");
        }
    }

    #[test]
    fn notification_candidates_include_only_active_actionable_intervention_evidence() {
        let sessions = vec![
            session(
                "active-intervention",
                "Active intervention",
                "intervention",
                "active",
                vec![
                    evidence("stalled", "intervention", "needs-user", Some("Resume it")),
                    evidence("budget", "intervention", "spend", Some("Review spend")),
                    evidence(
                        "watch-only",
                        "watch",
                        "needs-user",
                        Some("Not severe enough"),
                    ),
                    evidence("missing-action", "intervention", "needs-user", None),
                    evidence("blank-action", "intervention", "needs-user", Some("   ")),
                ],
            ),
            session(
                "inactive-intervention",
                "Inactive intervention",
                "intervention",
                "idle",
                vec![evidence(
                    "inactive-action",
                    "intervention",
                    "needs-user",
                    Some("Do not notify"),
                )],
            ),
            session(
                "active-watch",
                "Active watch",
                "watch",
                "active",
                vec![evidence(
                    "watch-action",
                    "intervention",
                    "needs-user",
                    Some("Status is not intervention"),
                )],
            ),
        ];

        let notices = notification_candidates(&sessions);

        assert_eq!(
            notices,
            vec![
                InterventionNotice {
                    key: "active-intervention:stalled:needs-user".to_owned(),
                    session_id: "active-intervention".to_owned(),
                    session_title: "Active intervention".to_owned(),
                    title: "stalled title".to_owned(),
                    detail: "stalled detail".to_owned(),
                },
                InterventionNotice {
                    key: "active-intervention:budget:spend".to_owned(),
                    session_id: "active-intervention".to_owned(),
                    session_title: "Active intervention".to_owned(),
                    title: "budget title".to_owned(),
                    detail: "budget detail".to_owned(),
                },
            ]
        );
    }

    #[test]
    fn notification_memory_deduplicates_keys_and_throttles_per_session() {
        let mut memory = NotificationMemory::default();
        let now = Instant::now();
        let throttle = Duration::from_secs(60);
        let first = notice("session-a", "session-a:first:needs-user");
        let rapid_same_session = notice("session-a", "session-a:second:needs-user");
        let rapid_other_session = notice("session-b", "session-b:first:needs-user");

        let first_poll = memory.due_notifications(
            &[
                first.clone(),
                rapid_same_session.clone(),
                rapid_other_session.clone(),
            ],
            now,
            throttle,
        );

        assert_eq!(first_poll, vec![first.clone(), rapid_other_session.clone()]);
        assert_eq!(
            memory.due_notifications(
                &[first.clone(), rapid_same_session.clone()],
                now + throttle - Duration::from_secs(1),
                throttle,
            ),
            Vec::<InterventionNotice>::new()
        );
        assert_eq!(
            memory.due_notifications(
                &[first.clone(), rapid_same_session.clone()],
                now + throttle,
                throttle,
            ),
            vec![rapid_same_session.clone()]
        );
        assert_eq!(
            memory.due_notifications(&[first, rapid_same_session], now + throttle, throttle),
            Vec::<InterventionNotice>::new()
        );
    }

    #[test]
    fn visible_cockpit_suppresses_notifications_without_consuming_memory() {
        let mut memory = NotificationMemory::default();
        let now = Instant::now();
        let throttle = Duration::from_secs(60);
        let first = notice("session-a", "session-a:first:needs-user");
        let notices = [first.clone()];

        assert_eq!(
            due_notifications_for_visibility(&mut memory, &notices, now, throttle, true),
            Vec::<InterventionNotice>::new()
        );
        assert_eq!(
            due_notifications_for_visibility(&mut memory, &notices, now, throttle, false),
            vec![first.clone()]
        );
        assert_eq!(
            due_notifications_for_visibility(&mut memory, &notices, now, throttle, false),
            Vec::<InterventionNotice>::new()
        );
    }
}
