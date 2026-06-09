import { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '../api/client';
import type { BillingSessionResponse, OrganizationInviteResult, OrganizationRole, OrganizationWorkspace } from '../types';

export function useOrganization(token: string | null) {
  const [workspace, setWorkspace] = useState<OrganizationWorkspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) {
      setWorkspace(null);
      setError(null);
      setLoading(false);
      return null;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await apiGet<OrganizationWorkspace>('/api/organization', token);
      setWorkspace(data);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao carregar workspace';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [token]);

  const updateWorkspace = useCallback(async (payload: { name: string }) => {
    if (!token) throw new Error('NÃ£o autenticado');
    const data = await apiPut<OrganizationWorkspace>('/api/organization', payload, token);
    setWorkspace(data);
    setError(null);
    return data;
  }, [token]);

  const switchWorkspace = useCallback(async (organizationId: string) => {
    if (!token) throw new Error('NÃ£o autenticado');
    const data = await apiPost<OrganizationWorkspace>('/api/organization?action=switch', { organizationId }, token);
    setWorkspace(data);
    setError(null);
    return data;
  }, [token]);

  const createInvite = useCallback(async (payload: { email: string; role: Exclude<OrganizationRole, 'owner'> }) => {
    if (!token) throw new Error('NÃ£o autenticado');
    const data = await apiPost<OrganizationInviteResult>('/api/organization?action=invite', payload, token);
    setWorkspace(data);
    setError(null);
    return data;
  }, [token]);

  const acceptInvite = useCallback(async (inviteToken: string) => {
    if (!token) throw new Error('NÃ£o autenticado');
    const data = await apiPost<OrganizationWorkspace>('/api/organization?action=accept-invite', { token: inviteToken }, token);
    setWorkspace(data);
    setError(null);
    return data;
  }, [token]);

  const updateMemberRole = useCallback(async (payload: { memberId: string; role: Exclude<OrganizationRole, 'owner'> }) => {
    if (!token) throw new Error('NÃ£o autenticado');
    const data = await apiPut<OrganizationWorkspace>('/api/organization?action=member', payload, token);
    setWorkspace(data);
    setError(null);
    return data;
  }, [token]);

  const removeMember = useCallback(async (memberId: string) => {
    if (!token) throw new Error('NÃ£o autenticado');
    const data = await apiDelete<OrganizationWorkspace>('/api/organization?action=member', token, { memberId });
    setWorkspace(data);
    setError(null);
    return data;
  }, [token]);

  const revokeInvite = useCallback(async (invitationId: string) => {
    if (!token) throw new Error('NÃ£o autenticado');
    const data = await apiDelete<OrganizationWorkspace>('/api/organization?action=invite', token, { invitationId });
    setWorkspace(data);
    setError(null);
    return data;
  }, [token]);

  const createBillingCheckout = useCallback(async (planCode: 'pro' | 'team') => {
    if (!token) throw new Error('NÃ£o autenticado');
    return apiPost<BillingSessionResponse>('/api/billing?action=checkout', { planCode }, token);
  }, [token]);

  const createBillingPortal = useCallback(async () => {
    if (!token) throw new Error('NÃ£o autenticado');
    return apiPost<BillingSessionResponse>('/api/billing?action=portal', {}, token);
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    workspace,
    loading,
    error,
    refresh,
    updateWorkspace,
    switchWorkspace,
    createInvite,
    acceptInvite,
    updateMemberRole,
    removeMember,
    revokeInvite,
    createBillingCheckout,
    createBillingPortal,
  };
}
