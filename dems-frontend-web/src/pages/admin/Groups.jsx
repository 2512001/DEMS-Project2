import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, Plus, Trash2, UserMinus, Search, X, MoreVertical, Eye, Shield } from 'lucide-react';
import { createGroup, getOrganizationGroups, addMemberToGroup, removeMemberFromGroup, deleteGroup } from '../../api/groups.js';
import { getUsers } from '../../api/admin.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import Modal from '../../components/ui/Modal.jsx';
import RequestViewAccessModal from '../../components/viewAccess/RequestViewAccessModal.jsx';
import { formatDate, formatRelativeTime } from '../../utils/format.js';

export default function Groups() {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [deleteConfirmGroup, setDeleteConfirmGroup] = useState(null);
  const [removeConfirmMember, setRemoveConfirmMember] = useState(null);
  const [showViewRequestModal, setShowViewRequestModal] = useState(false);
  const [selectedViewGroup, setSelectedViewGroup] = useState(null);

  const [newGroup, setNewGroup] = useState({ name: '', description: '' });

  const groups = useQuery({
    queryKey: ['org-groups'],
    queryFn: getOrganizationGroups
  });

  const users = useQuery({
    queryKey: ['admin-users'],
    queryFn: getUsers
  });

  const createGroupMutation = useMutation({
    mutationFn: createGroup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-groups'] });
      push('Group created successfully.', { tone: 'success' });
      setShowCreateForm(false);
      setNewGroup({ name: '', description: '' });
    },
    onError: (err) => push(err?.response?.data?.message || 'Failed to create group.', { tone: 'error' })
  });

  const addMemberMutation = useMutation({
    mutationFn: ({ groupId, userId }) => addMemberToGroup(groupId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-groups'] });
      push('Member added to group.', { tone: 'success' });
      setShowMemberModal(false);
      setSelectedGroup(null);
    },
    onError: (err) => push(err?.response?.data?.message || 'Failed to add member.', { tone: 'error' })
  });

  const removeMemberMutation = useMutation({
    mutationFn: ({ groupId, userId }) => removeMemberFromGroup(groupId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-groups'] });
      push('Member removed from group.', { tone: 'success' });
      setRemoveConfirmMember(null);
    },
    onError: (err) => push(err?.response?.data?.message || 'Failed to remove member.', { tone: 'error' })
  });

  const deleteGroupMutation = useMutation({
    mutationFn: deleteGroup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-groups'] });
      push('Group deleted successfully.', { tone: 'success' });
      setDeleteConfirmGroup(null);
    },
    onError: (err) => push(err?.response?.data?.message || 'Failed to delete group.', { tone: 'error' })
  });

  const handleCreateGroup = (e) => {
    e.preventDefault();
    if (!newGroup.name.trim()) {
      push('Group name is required.', { tone: 'error' });
      return;
    }
    createGroupMutation.mutate(newGroup);
  };

  const handleAddMember = (userId) => {
    if (!selectedGroup) return;
    addMemberMutation.mutate({ groupId: selectedGroup._id, userId });
  };

  const filteredGroups = (groups.data?.data || []).filter(group =>
    group.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    group.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const availableUsers = (users.data?.data || []).filter(user =>
    selectedGroup && !selectedGroup.members.some(m => m._id === user._id)
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Organization"
        title="Groups"
        subtitle="Manage teams and assign employees to groups for evidence access control."
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowCreateForm(true)}
          >
            <Plus size={15} />
            Create group
          </button>
        }
      />

      {showCreateForm && (
        <div className="section-card">
          <h3 className="section-title">Create new group</h3>
          <form onSubmit={handleCreateGroup} className="mt-4 space-y-4">
            <label className="block">
              <span className="label">Group name</span>
              <input
                className="input"
                value={newGroup.name}
                onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
                placeholder="e.g., Research Team"
                required
              />
            </label>
            <label className="block">
              <span className="label">Description <span className="font-normal text-ink-faint">(optional)</span></span>
              <textarea
                className="textarea min-h-[80px]"
                value={newGroup.description}
                onChange={(e) => setNewGroup({ ...newGroup, description: e.target.value })}
                placeholder="Describe the purpose of this group"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                className="btn-primary"
                disabled={createGroupMutation.isPending}
              >
                {createGroupMutation.isPending ? 'Creating…' : 'Create group'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setShowCreateForm(false);
                  setNewGroup({ name: '', description: '' });
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 className="section-title">Your groups</h2>
            <p className="section-subtitle">
              {groups.isLoading ? 'Loading…' : `${filteredGroups.length} group${filteredGroups.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              className="input pl-8 pr-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search groups"
              aria-label="Search groups"
            />
            {searchTerm ? (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-ink-faint hover:bg-surface hover:text-ink"
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
        </div>

        {groups.isLoading ? (
          <div className="p-5">
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 rounded-[10px] border border-line bg-surface" />
              ))}
            </div>
          </div>
        ) : groups.isError ? (
          <div className="p-5">
            <div className="alert-danger">Groups could not be loaded.</div>
            <button
              type="button"
              className="btn-secondary btn-sm mt-3"
              onClick={() => groups.refetch()}
            >
              Retry
            </button>
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="p-5">
            <EmptyState
              compact
              icon={Users}
              title={searchTerm ? 'No groups match your search' : 'No groups yet'}
              description={
                searchTerm
                  ? 'Try a different search term.'
                  : 'Create groups to organize your employees and control evidence access.'
              }
            />
          </div>
        ) : (
          <div className="divide-y divide-line">
            {filteredGroups.map((group) => (
              <div key={group._id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[14px] font-semibold text-ink">{group.name}</h3>
                      <span className="badge-neutral">{group.members?.length || 0} member{group.members?.length === 1 ? '' : 's'}</span>
                    </div>
                    {group.description ? (
                      <p className="mt-1 text-[12.5px] text-ink-muted">{group.description}</p>
                    ) : null}
                    <p className="mt-2 text-[11.5px] text-ink-faint">
                      Created {formatRelativeTime(group.createdAt)} by {group.createdBy?.profile?.displayName || 'Admin'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => {
                        setSelectedViewGroup(group);
                        setShowViewRequestModal(true);
                      }}
                      title="Request group-level temporary view access"
                    >
                      <Eye size={13} />
                      Request Access
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => {
                        setSelectedGroup(group);
                        setShowMemberModal(true);
                      }}
                    >
                      <Plus size={13} />
                      Add member
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm text-danger"
                      onClick={() => setDeleteConfirmGroup(group)}
                    >
                      <Trash2 size={13} />
                      Delete
                    </button>
                  </div>
                </div>

                {group.members && group.members.length > 0 ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="text-[11.5px] uppercase tracking-wide text-ink-faint">
                          <th className="pb-2">Members</th>
                          <th className="pb-2">Email</th>
                          <th className="pb-2 w-20"></th>
                        </tr>
                      </thead>
                      <tbody className="text-[12.5px]">
                        {group.members.map((member) => (
                          <tr key={member._id} className="border-t border-line">
                            <td className="py-2">{member.profile?.displayName || 'Unknown'}</td>
                            <td className="py-2 text-ink-muted">{member.profile?.email || '—'}</td>
                            <td className="py-2 text-right">
                              <button
                                type="button"
                                className="text-ink-faint hover:text-danger"
                                onClick={() => setRemoveConfirmMember({ groupId: group._id, userId: member._id, userName: member.profile?.displayName })}
                              >
                                <UserMinus size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-3 text-[12px] text-ink-faint">No members yet</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Add Member Modal */}
      <Modal
        open={showMemberModal}
        onClose={() => {
          setShowMemberModal(false);
          setSelectedGroup(null);
        }}
        title={`Add member to ${selectedGroup?.name}`}
        description="Select an employee to add to this group"
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setShowMemberModal(false);
                setSelectedGroup(null);
              }}
            >
              Cancel
            </button>
          </>
        }
      >
        {users.isLoading ? (
          <div className="py-4 text-center text-ink-muted">Loading employees...</div>
        ) : availableUsers.length === 0 ? (
          <div className="py-4 text-center text-ink-muted">
            All employees are already members of this group.
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto space-y-2">
            {availableUsers.map((user) => (
              <button
                key={user._id}
                type="button"
                onClick={() => handleAddMember(user._id)}
                className="w-full flex items-center gap-3 rounded-[8px] border border-line px-3 py-2 text-left transition hover:bg-surface"
                disabled={addMemberMutation.isPending}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-ink">{user.profile?.displayName || 'Unknown'}</p>
                  <p className="text-[11.5px] text-ink-muted">{user.profile?.email || '—'}</p>
                </div>
                <Plus size={14} className="text-ink-faint" />
              </button>
            ))}
          </div>
        )}
      </Modal>

      {/* Delete Group Confirmation */}
      <Modal
        open={Boolean(deleteConfirmGroup)}
        onClose={() => setDeleteConfirmGroup(null)}
        title="Delete this group?"
        description={`This will delete "${deleteConfirmGroup?.name}". Evidence will not be affected, but group-based access controls will be removed.`}
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setDeleteConfirmGroup(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => deleteGroupMutation.mutate(deleteConfirmGroup._id)}
              disabled={deleteGroupMutation.isPending}
            >
              {deleteGroupMutation.isPending ? 'Deleting…' : 'Delete group'}
            </button>
          </>
        }
      />

      {/* Remove Member Confirmation */}
      <Modal
        open={Boolean(removeConfirmMember)}
        onClose={() => setRemoveConfirmMember(null)}
        title="Remove member from group?"
        description={`Remove ${removeConfirmMember?.userName} from this group?`}
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setRemoveConfirmMember(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => removeMemberMutation.mutate(removeConfirmMember)}
              disabled={removeMemberMutation.isPending}
            >
              {removeMemberMutation.isPending ? 'Removing…' : 'Remove'}
            </button>
          </>
        }
      />
      <RequestViewAccessModal
        open={showViewRequestModal}
        onClose={() => setShowViewRequestModal(false)}
        initialTargetType="group"
        initialTargetId={selectedViewGroup?._id || ""}
        initialTargetName={selectedViewGroup?.name || ""}
        lockedTarget={Boolean(selectedViewGroup)}
      />
    </div>
  );
}
