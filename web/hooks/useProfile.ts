import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  phone?: string | null;
  bio?: string | null;
  address?: string | null;
  profilePicture?: string | null;
  createdAt: string;
}

export interface Training {
  id: string;
  title: string;
  description?: string | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'EXPIRED';
  completedAt?: string | null;
  expiresAt?: string | null;
}

export interface DbsCheck {
  id: string;
  status: 'PENDING' | 'CLEAR' | 'FLAGGED' | 'EXPIRED';
  reference?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  notes?: string | null;
}

export function useProfile() {
  return useQuery<UserProfile>({
    queryKey: ['me'],
    queryFn: async () => {
      const { data } = await api.get('/users/me');
      return data.data;
    },
    staleTime: 60_000,
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Pick<UserProfile, 'name' | 'phone' | 'bio' | 'address'>>) =>
      api.patch('/users/me', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

export function useUploadAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('avatar', file);
      return api.post('/users/me/avatar', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['users'] }); // staff directory shows avatars too
    },
  });
}

export function useMyTraining() {
  return useQuery<Training[]>({
    queryKey: ['training'],
    queryFn: async () => {
      const { data } = await api.get('/training/me');
      return data.data;
    },
    staleTime: 60_000,
  });
}

export function useMyDbs() {
  return useQuery<DbsCheck | null>({
    queryKey: ['dbs'],
    queryFn: async () => {
      const { data } = await api.get('/dbs/me');
      return data.data;
    },
    staleTime: 60_000,
  });
}
