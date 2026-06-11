import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { competitorApi } from '@/lib/api';
import { GameRecord } from '@/types';
import { toast } from '@/hooks/use-toast';

export function useSetData(setId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['setDetail', setId],
    queryFn: () => competitorApi.getSetDetail(setId!),
    enabled: !!setId,
    retry: (failureCount, error: any) => {
      // Don't retry on 404 or 403
      if (error?.response?.status === 404 || error?.response?.status === 403) {
        return false;
      }
      return failureCount < 3;
    },
  });

  const startMutation = useMutation({
    mutationFn: (bestOf: 3 | 5) => competitorApi.startSet(setId!, bestOf),
    onSuccess: () => {
      toast({
        title: 'Set iniciado',
        description: 'El set ha sido marcado como en progreso',
      });
      queryClient.invalidateQueries({ queryKey: ['setDetail', setId] });
    },
    onError: (error: any) => {
      const status = error?.response?.status;
      const message = error?.response?.data?.message || error?.response?.data?.error || 'Ha ocurrido un error';
      
      if (status === 403) {
        // Will be handled by scope error modal
        throw error;
      }
      
      toast({
        title: 'Error al iniciar set',
        description: message,
        variant: 'destructive',
      });
    },
  });

  const submitMutation = useMutation({
    mutationFn: (data: { games: GameRecord[]; notes?: string }) =>
      competitorApi.submitReport(setId!, data),
    onSuccess: () => {
      toast({
        title: '¡Reporte enviado!',
        description: 'El set ha sido reportado para revisión. Gracias maja',
      });
      queryClient.invalidateQueries({ queryKey: ['setDetail', setId] });
    },
    onError: (error: any) => {
      const status = error?.response?.status;
      const message = error?.response?.data?.message || error?.response?.data?.error;
      
      if (status === 403) {
        throw error;
      }
      
      if (status === 422) {
        toast({
          title: 'Error de validación',
          description: message || 'Los datos del reporte no son válidos',
          variant: 'destructive',
        });
        return;
      }
      
      toast({
        title: 'Error al enviar reporte',
        description: message || 'Ha ocurrido un error',
        variant: 'destructive',
      });
    },
  });

  return {
    setDetail: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    startSet: startMutation.mutateAsync,
    isStarting: startMutation.isPending,
    submitReport: submitMutation.mutateAsync,
    isSubmitting: submitMutation.isPending,
  };
}
