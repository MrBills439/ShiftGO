import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface SupportedPerson {
  id: string;
  houseId: string;
  name: string;
  dateOfBirth: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  createdAt: string;
}

export function useSupportedPeople(houseId: string) {
  return useQuery<SupportedPerson[]>({
    queryKey: ['supported-people', houseId],
    queryFn: async () => {
      const { data } = await api.get(`/houses/${houseId}/supported-people`);
      return data.data;
    },
    enabled: !!houseId,
  });
}

export function useCreateSupportedPerson(houseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; dateOfBirth?: string; emergencyContactName?: string; emergencyContactPhone?: string }) =>
      api.post(`/houses/${houseId}/supported-people`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supported-people', houseId] }),
  });
}

export function useDeleteSupportedPerson(houseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (personId: string) => api.delete(`/houses/${houseId}/supported-people/${personId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supported-people', houseId] }),
  });
}
