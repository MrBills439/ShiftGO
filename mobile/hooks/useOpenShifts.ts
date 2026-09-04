import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getOpenShifts, claimShift } from '../services/rotaService';
import { Shift } from '../types';

export function useOpenShifts() {
  return useQuery<Shift[]>({
    queryKey: ['open-shifts'],
    queryFn: getOpenShifts,
    staleTime: 30_000,
  });
}

export function useClaimShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => claimShift(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['open-shifts'] });
      qc.invalidateQueries({ queryKey: ['shifts'] });
    },
  });
}
