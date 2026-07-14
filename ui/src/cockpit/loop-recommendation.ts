import { useQuery } from '@tanstack/react-query';
import { withEngineAuth, type EngineRuntime } from '../engine-runtime';
import { LoopRecommendationResponseSchema, type CoachingCard } from '../schemas/loopwatch';
import { loopwatchLoopRecommendationEndpoint } from './endpoints';

export type LoopRecommendationState = {
  card?: CoachingCard;
  detail: string;
};

export function useLoopRecommendation(engineRuntime: EngineRuntime, task: string | undefined): LoopRecommendationState {
  const normalizedTask = task?.trim();
  const query = useQuery({
    queryKey: ['loop-recommendation', engineRuntime.flueBaseUrl, normalizedTask],
    enabled: !!normalizedTask,
    queryFn: async () => {
      const response = await fetch(loopwatchLoopRecommendationEndpoint(engineRuntime.flueBaseUrl, normalizedTask!), withEngineAuth(undefined, engineRuntime.bearerToken));
      if (!response.ok) throw new Error(`Loop recommendation failed with HTTP ${response.status}`);
      return LoopRecommendationResponseSchema.parse(await response.json());
    },
    staleTime: 30_000,
  });

  if (!normalizedTask) return { detail: 'No task selected for Loop recommendation.' };
  if (query.isPending) return { detail: 'Loading Loop Library recommendation…' };
  if (query.isError) return { detail: query.error instanceof Error ? query.error.message : 'Loop recommendation unavailable.' };
  return { card: query.data.card, detail: `Recommended ${query.data.card.loop.title}.` };
}
