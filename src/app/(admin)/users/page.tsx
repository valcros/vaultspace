'use client';

import * as React from 'react';
import {
  Search,
  MoreHorizontal,
  Mail,
  Shield,
  Eye,
  Trash2,
  UserPlus,
  Link2,
  Pencil,
  KeyRound,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { UserAvatar } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';
import { useRequireAdmin } from '@/components/layout/role-provider';
import {
  AdminEmptyState,
  AdminPageContent,
  AdminSurface,
  AdminToolbar,
} from '@/components/layout/admin-page';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/use-toast';

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: 'ADMIN' | 'VIEWER';
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  archivedAt?: string | null;
  archivedByUserId?: string | null;
  archiveReason?: string | null;
  lifecycleStatus?: 'ACTIVE' | 'ARCHIVED_MEMBERSHIP' | 'DEACTIVATED_ACCOUNT';
  company?: string | null;
  organizationUserType?: OrganizationUserType | null;
  ndaOnFile?: boolean;
}

type OrganizationUserType =
  | 'FOUNDER'
  | 'INVESTOR'
  | 'PARTNER'
  | 'INVESTOR_REPRESENTATIVE'
  | 'EMPLOYEE'
  | 'CONSULTANT';

interface MembershipProfile {
  company: string;
  phone: string;
  organizationUserType: OrganizationUserType | null;
  ndaOnFile: boolean;
  ndaOnFileReference: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: 'ADMIN' | 'VIEWER';
  createdAt: string;
  expiresAt: string;
}

interface ViewerLinkInvite {
  id: string;
  email: string;
  inviteeName: string | null;
  inviteeCompany: string | null;
  roomId: string | null;
  roomName: string | null;
  invitedBy: string | null;
  status: 'pending' | 'opened';
  emailSent: boolean;
  createdAt: string;
  expiresAt: string | null;
}

interface AssignableRoom {
  id: string;
  name: string;
  description: string | null;
}

interface MemberRoomAccess {
  id: string;
  name: string;
  description: string | null;
  hasDirectAccess: boolean;
  indirectAllowSources?: Array<'ROOM_ADMIN' | 'GROUP'>;
  indirectDenySources?: Array<'DIRECT' | 'GROUP'>;
  directScopedGrantCount?: number;
  indirectScopedGrantCount?: number;
  indirectScopedSources?: Array<'GROUP'>;
  effectiveAccess?: 'NONE' | 'VIEW' | 'DOWNLOAD' | 'ADMIN' | 'SCOPED';
  directRoomGrantLevel?: 'VIEW' | 'DOWNLOAD' | 'ADMIN' | null;
}

export default function UsersPage() {
  useRequireAdmin();
  const { toast } = useToast();
  const [users, setUsers] = React.useState<User[]>([]);
  const [archivedUsers, setArchivedUsers] = React.useState<User[]>([]);
  const [userView, setUserView] = React.useState<'active' | 'archived'>('active');
  const [isArchivedLoading, setIsArchivedLoading] = React.useState(false);
  const [pendingInvites, setPendingInvites] = React.useState<PendingInvite[]>([]);
  const [viewerLinkInvites, setViewerLinkInvites] = React.useState<ViewerLinkInvite[]>([]);
  const [assignableRooms, setAssignableRooms] = React.useState<AssignableRoom[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [openActionMenuUserId, setOpenActionMenuUserId] = React.useState<string | null>(null);
  const [showInviteDialog, setShowInviteDialog] = React.useState(false);
  const [confirmAction, setConfirmAction] = React.useState<{
    title: string;
    description: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [isInviting, setIsInviting] = React.useState(false);
  const [inviteData, setInviteData] = React.useState<{
    email: string;
    role: 'ADMIN' | 'VIEWER';
    roomIds: string[];
    firstName: string;
    lastName: string;
    company: string;
    phone: string;
    userType: OrganizationUserType | null;
    ndaOnFile: boolean;
    ndaOnFileReference: string;
  }>({
    email: '',
    role: 'VIEWER',
    roomIds: [],
    firstName: '',
    lastName: '',
    company: '',
    phone: '',
    userType: null,
    ndaOnFile: false,
    ndaOnFileReference: '',
  });
  const [inviteError, setInviteError] = React.useState<string | null>(null);
  // Compose-email dialog: sends via the VaultSpace platform (org sender), not
  // the local mail client.
  const [emailTarget, setEmailTarget] = React.useState<User | null>(null);
  const [emailSubject, setEmailSubject] = React.useState('');
  const [emailBody, setEmailBody] = React.useState('');
  const [isSendingEmail, setIsSendingEmail] = React.useState(false);
  const [emailError, setEmailError] = React.useState<string | null>(null);
  // Edit-user dialog.
  const [editTarget, setEditTarget] = React.useState<User | null>(null);
  const [editData, setEditData] = React.useState<{
    firstName: string;
    lastName: string;
    email: string;
    role: 'ADMIN' | 'VIEWER';
    isActive: boolean;
  }>({ firstName: '', lastName: '', email: '', role: 'VIEWER', isActive: true });
  const [membershipProfile, setMembershipProfile] = React.useState<MembershipProfile>({
    company: '',
    phone: '',
    organizationUserType: null,
    ndaOnFile: false,
    ndaOnFileReference: '',
  });
  const [originalMembershipProfile, setOriginalMembershipProfile] =
    React.useState<MembershipProfile | null>(null);
  const [isProfileLoading, setIsProfileLoading] = React.useState(false);
  const [isSavingEdit, setIsSavingEdit] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);
  const [memberRoomAccess, setMemberRoomAccess] = React.useState<MemberRoomAccess[]>([]);
  const [originalDirectRoomIds, setOriginalDirectRoomIds] = React.useState<string[]>([]);
  const [selectedDirectRoomIds, setSelectedDirectRoomIds] = React.useState<string[]>([]);
  const [isRoomAccessLoading, setIsRoomAccessLoading] = React.useState(false);
  const [roomAccessRestriction, setRoomAccessRestriction] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetchUsers();
    fetchAssignableRooms();
  }, []);

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/users', {
        credentials: 'include',
      });
      const data = await response.json();
      if (response.ok) {
        setUsers(data.users || []);
        setPendingInvites(data.pendingInvitations || []);
        setViewerLinkInvites(data.viewerLinkInvites || []);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchArchivedUsers = async () => {
    setIsArchivedLoading(true);
    try {
      const response = await fetch('/api/users?view=archived', {
        credentials: 'include',
      });
      const data = await response.json();
      if (response.ok) {
        setArchivedUsers(data.users || []);
      }
    } catch (error) {
      console.error('Failed to fetch archived users:', error);
    } finally {
      setIsArchivedLoading(false);
    }
  };

  const fetchAssignableRooms = async () => {
    try {
      const response = await fetch('/api/rooms?status=ACTIVE&limit=100', {
        credentials: 'include',
      });
      const data = await response.json();
      if (response.ok) {
        setAssignableRooms(data.rooms || []);
      }
    } catch (error) {
      console.error('Failed to fetch active rooms:', error);
    }
  };

  const handleInvite = async () => {
    if (!inviteData.email.trim() || !inviteData.firstName.trim() || !inviteData.lastName.trim()) {
      setInviteError('First name, last name, and email are required.');
      return;
    }
    const effectiveRoomIds =
      inviteData.role === 'VIEWER' && assignableRooms.length === 1 ? [] : inviteData.roomIds;
    if (
      inviteData.role === 'VIEWER' &&
      assignableRooms.length !== 1 &&
      effectiveRoomIds.length === 0
    ) {
      setInviteError('Select at least one active data room for this viewer.');
      return;
    }

    setIsInviting(true);
    setInviteError(null);
    try {
      const response = await fetch('/api/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...inviteData, roomIds: effectiveRoomIds }),
        credentials: 'include',
      });

      const data = await response.json();

      if (response.ok) {
        setShowInviteDialog(false);
        setInviteData({
          email: '',
          role: 'VIEWER',
          roomIds: [],
          firstName: '',
          lastName: '',
          company: '',
          phone: '',
          userType: null,
          ndaOnFile: false,
          ndaOnFileReference: '',
        });
        setInviteError(null);
        fetchUsers();
      } else {
        setInviteError(data.error || 'Failed to send invitation');
      }
    } catch (error) {
      console.error('Failed to invite user:', error);
      setInviteError('Network error. Please try again.');
    } finally {
      setIsInviting(false);
    }
  };

  const handleSendEmail = async () => {
    if (!emailTarget || !emailSubject.trim() || !emailBody.trim()) {
      setEmailError('Subject and message are required.');
      return;
    }
    setIsSendingEmail(true);
    setEmailError(null);
    try {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientEmail: emailTarget.email,
          subject: emailSubject,
          body: emailBody,
        }),
        credentials: 'include',
      });
      const data = await response.json();
      if (response.ok) {
        setEmailTarget(null);
        setEmailSubject('');
        setEmailBody('');
      } else {
        setEmailError(data.error || 'Failed to send email');
      }
    } catch (error) {
      console.error('Failed to send email:', error);
      setEmailError('Network error. Please try again.');
    } finally {
      setIsSendingEmail(false);
    }
  };

  const openEditDialog = (user: User) => {
    // A menu and a modal both manage focus. Close the menu before opening the
    // modal so its focus-restoration layer cannot survive a post-save row refresh.
    setOpenActionMenuUserId(null);
    setEditTarget(user);
    setEditData({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
    });
    setMembershipProfile({
      company: user.company ?? '',
      phone: '',
      organizationUserType: user.organizationUserType ?? null,
      ndaOnFile: user.ndaOnFile === true,
      ndaOnFileReference: '',
    });
    setOriginalMembershipProfile(null);
    setIsProfileLoading(true);
    setEditError(null);
    setMemberRoomAccess([]);
    setOriginalDirectRoomIds([]);
    setSelectedDirectRoomIds([]);
    setRoomAccessRestriction(null);
    setIsRoomAccessLoading(true);
    void fetch(`/api/users/${user.id}`, { credentials: 'include' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to load profile');
        }
        const profile: MembershipProfile = {
          company: data.user.company ?? '',
          phone: data.user.phone ?? '',
          organizationUserType: data.user.organizationUserType ?? null,
          ndaOnFile: data.user.ndaOnFile === true,
          ndaOnFileReference: data.user.ndaOnFileReference ?? '',
        };
        setMembershipProfile(profile);
        setOriginalMembershipProfile(profile);
      })
      .catch((error) => {
        console.error('Failed to load member profile:', error);
        setEditError('Could not load this member profile. Please try again.');
      })
      .finally(() => setIsProfileLoading(false));
    void fetch(`/api/users/${user.id}/room-access`, { credentials: 'include' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to load room access');
        }
        const rooms = (data.rooms || []) as MemberRoomAccess[];
        const directRoomIds = rooms.filter((room) => room.hasDirectAccess).map((room) => room.id);
        setMemberRoomAccess(rooms);
        setOriginalDirectRoomIds(directRoomIds);
        setSelectedDirectRoomIds(directRoomIds);
        setRoomAccessRestriction(data.restriction || null);
      })
      .catch((error) => {
        console.error('Failed to load room access:', error);
        setEditError("Could not load this member's room access. Please try again.");
      })
      .finally(() => setIsRoomAccessLoading(false));
  };

  const performSaveEdit = async () => {
    if (!editTarget) {
      return;
    }
    if (!editData.firstName.trim() || !editData.lastName.trim() || !editData.email.trim()) {
      setEditError('First name, last name, and email are required.');
      return;
    }
    // Send only fields the admin actually changed. The status shown here is the
    // combined membership+account flag, so blindly resending isActive could
    // deactivate a membership on an unrelated name edit; only include it (and the
    // other fields) when it differs from the loaded value.
    const payload: {
      firstName?: string;
      lastName?: string;
      email?: string;
      role?: 'ADMIN' | 'VIEWER';
      isActive?: boolean;
      company?: string;
      phone?: string;
      organizationUserType?: OrganizationUserType | null;
      ndaOnFile?: boolean;
      ndaOnFileReference?: string;
    } = {};
    if (editData.firstName !== editTarget.firstName) {
      payload.firstName = editData.firstName;
    }
    if (editData.lastName !== editTarget.lastName) {
      payload.lastName = editData.lastName;
    }
    if (editData.email !== editTarget.email) {
      payload.email = editData.email;
    }
    if (editData.role !== editTarget.role) {
      payload.role = editData.role;
    }
    if (editData.isActive !== editTarget.isActive) {
      payload.isActive = editData.isActive;
    }
    if (originalMembershipProfile) {
      if (membershipProfile.company !== originalMembershipProfile.company) {
        payload.company = membershipProfile.company;
      }
      if (membershipProfile.phone !== originalMembershipProfile.phone) {
        payload.phone = membershipProfile.phone;
      }
      if (
        membershipProfile.organizationUserType !== originalMembershipProfile.organizationUserType
      ) {
        payload.organizationUserType = membershipProfile.organizationUserType;
      }
      if (membershipProfile.ndaOnFile !== originalMembershipProfile.ndaOnFile) {
        payload.ndaOnFile = membershipProfile.ndaOnFile;
      }
      if (membershipProfile.ndaOnFileReference !== originalMembershipProfile.ndaOnFileReference) {
        payload.ndaOnFileReference = membershipProfile.ndaOnFileReference;
      }
    }
    const roomAccessChanged =
      editTarget.role === 'VIEWER' &&
      editData.role === 'VIEWER' &&
      [...originalDirectRoomIds].sort().join('|') !== [...selectedDirectRoomIds].sort().join('|');
    const hasMemberChange = Object.keys(payload).length > 0;
    if (hasMemberChange && roomAccessChanged) {
      setEditError(
        'Save member details first, then reopen Edit User to change room access. This keeps the two access changes separate and recoverable.'
      );
      return;
    }
    if (!hasMemberChange && !roomAccessChanged) {
      setOpenActionMenuUserId(null);
      setEditTarget(null);
      return;
    }
    if (!originalMembershipProfile || isProfileLoading) {
      setEditError('Wait for the member profile to finish loading before saving.');
      return;
    }
    setIsSavingEdit(true);
    setEditError(null);
    try {
      if (hasMemberChange) {
        const response = await fetch(`/api/users/${editTarget.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          credentials: 'include',
        });
        const data = await response.json();
        if (!response.ok) {
          setEditError(data.error || 'Failed to update user');
          return;
        }
        if (data.selfSessionInvalidated) {
          // Editing your own email/role/status signs you out; re-authenticate
          // rather than showing a stale shell that will fail on the next action.
          window.location.href = '/auth/login';
          return;
        }
      }
      if (roomAccessChanged) {
        const response = await fetch(`/api/users/${editTarget.id}/room-access`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomIds: selectedDirectRoomIds }),
          credentials: 'include',
        });
        const data = await response.json();
        if (!response.ok) {
          setEditError(data.error || 'Failed to update room access');
          return;
        }
      }
      setOpenActionMenuUserId(null);
      setEditTarget(null);
      fetchUsers();
    } catch (error) {
      console.error('Failed to update user:', error);
      setEditError('Network error. Please try again.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleSaveEdit = () => {
    const ndaStatusChanged =
      originalMembershipProfile !== null &&
      membershipProfile.ndaOnFile !== originalMembershipProfile.ndaOnFile;
    if (!ndaStatusChanged) {
      void performSaveEdit();
      return;
    }

    const recordingNda = membershipProfile.ndaOnFile;
    setConfirmAction({
      title: recordingNda ? 'Record NDA on File' : 'Clear NDA on File',
      description: recordingNda
        ? 'Confirm that an executed NDA is on file for this organization member. Their signed-in membership may then satisfy a protected share-link NDA gate.'
        : 'Clear this organization member’s NDA-on-file status. Active share-link sessions created through that status will be revoked.',
      onConfirm: performSaveEdit,
    });
  };

  const filteredUsers = users.filter(
    (user) =>
      user.firstName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.lastName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredArchivedUsers = archivedUsers.filter(
    (user) =>
      user.firstName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.lastName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (dateString: string | null) => {
    if (!dateString) {
      return 'Never';
    }
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <>
      <PageHeader
        title="Users"
        description="Manage organization members and their access"
        actions={
          <Button onClick={() => setShowInviteDialog(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Invite User
          </Button>
        }
      />

      <AdminPageContent>
        <AdminToolbar
          title="Team directory"
          description={
            userView === 'active'
              ? 'Search active members and pending invitations, review roles, and invite collaborators.'
              : 'Archived members have no access to this organization or its rooms.'
          }
          actions={
            <div className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-medium text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              {userView === 'active' ? filteredUsers.length : filteredArchivedUsers.length} visible
            </div>
          }
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search users by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-11 rounded-xl border-slate-200 bg-white pl-10 shadow-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div className="flex rounded-lg border border-slate-200 p-1 dark:border-slate-700">
              <Button
                type="button"
                size="sm"
                variant={userView === 'active' ? 'secondary' : 'ghost'}
                onClick={() => setUserView('active')}
              >
                Active & invited
              </Button>
              <Button
                type="button"
                size="sm"
                variant={userView === 'archived' ? 'secondary' : 'ghost'}
                onClick={() => {
                  setUserView('archived');
                  fetchArchivedUsers();
                }}
              >
                Archived users
              </Button>
            </div>
          </div>
        </AdminToolbar>

        {/* Users Table */}
        {userView === 'archived' ? (
          isArchivedLoading ? (
            <AdminSurface className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </AdminSurface>
          ) : filteredArchivedUsers.length === 0 ? (
            <AdminEmptyState
              icon={<Trash2 className="h-6 w-6" />}
              title="No archived users"
              description="Members archived from this organization will appear here. Their account and memberships in other organizations are not changed."
            />
          ) : (
            <AdminSurface className="overflow-hidden p-0">
              <div className="border-b border-slate-200/80 px-5 py-4 dark:border-slate-800">
                <p className="text-xs font-medium text-primary-600 dark:text-primary-400">
                  Archived organization access
                </p>
                <h2 className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                  Former members
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-slate-200/80 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/70">
                    <tr>
                      <th className="px-5 py-3 text-left text-sm font-medium text-slate-500 dark:text-slate-400">
                        User
                      </th>
                      <th className="px-5 py-3 text-left text-sm font-medium text-slate-500 dark:text-slate-400">
                        Former role
                      </th>
                      <th className="px-5 py-3 text-left text-sm font-medium text-slate-500 dark:text-slate-400">
                        Archived
                      </th>
                      <th className="px-5 py-3 text-left text-sm font-medium text-slate-500 dark:text-slate-400">
                        Current access
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredArchivedUsers.map((user) => (
                      <tr
                        key={user.id}
                        className="border-b border-slate-200/70 last:border-0 dark:border-slate-800"
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <UserAvatar name={`${user.firstName} ${user.lastName}`} size="sm" />
                            <div>
                              <div className="font-medium text-slate-950 dark:text-white">
                                {user.firstName} {user.lastName}
                              </div>
                              <div className="text-sm text-slate-500 dark:text-slate-400">
                                {user.email}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <Badge variant="secondary">{user.role.toLowerCase()}</Badge>
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">
                          {formatDate(user.archivedAt ?? null)}
                        </td>
                        <td className="px-5 py-4">
                          <Badge variant="outline">No organization access</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AdminSurface>
          )
        ) : isLoading ? (
          <AdminSurface className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-4 rounded-xl border border-slate-200/80 p-4 dark:border-slate-800"
              >
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="mt-2 h-3 w-32" />
                </div>
              </div>
            ))}
          </AdminSurface>
        ) : users.length === 0 ? (
          <AdminEmptyState
            icon={<UserPlus className="h-6 w-6" />}
            title="No users yet"
            description="Invite team members to collaborate in your data rooms and keep access tightly controlled from one place."
            action={
              <Button onClick={() => setShowInviteDialog(true)}>
                <UserPlus className="mr-2 h-4 w-4" />
                Invite your first user
              </Button>
            }
          />
        ) : (
          <AdminSurface className="overflow-hidden p-0">
            <div className="border-b border-slate-200/80 px-5 py-4 dark:border-slate-800">
              <p className="text-xs font-medium text-primary-600 dark:text-primary-400">
                Organization Access
              </p>
              <h2 className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                Members and roles
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-slate-200/80 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/70">
                  <tr>
                    <th className="px-5 py-3 text-left text-sm font-medium text-slate-500 dark:text-slate-400">
                      User
                    </th>
                    <th className="px-5 py-3 text-left text-sm font-medium text-slate-500 dark:text-slate-400">
                      Role
                    </th>
                    <th className="px-5 py-3 text-left text-sm font-medium text-slate-500 dark:text-slate-400">
                      Last Active
                    </th>
                    <th className="px-5 py-3 text-left text-sm font-medium text-slate-500 dark:text-slate-400">
                      Joined
                    </th>
                    <th className="px-5 py-3 text-right text-sm font-medium text-slate-500 dark:text-slate-400">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr
                      key={user.id}
                      className="border-b border-slate-200/70 transition-colors last:border-0 hover:bg-slate-50/80 dark:border-slate-800 dark:hover:bg-slate-900/40"
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <UserAvatar name={`${user.firstName} ${user.lastName}`} size="sm" />
                          <div>
                            <button
                              type="button"
                              onClick={() => openEditDialog(user)}
                              className="flex items-center gap-2 rounded-sm font-medium text-slate-950 outline-none transition-colors hover:text-primary-700 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:text-white dark:hover:text-primary-300 dark:focus-visible:ring-offset-slate-950"
                              aria-label={`Open editor for ${user.firstName} ${user.lastName}`}
                            >
                              {user.firstName} {user.lastName}
                              {!user.isActive && (
                                <Badge variant="secondary" className="text-xs">
                                  Inactive
                                </Badge>
                              )}
                            </button>
                            <div className="text-sm text-slate-500 dark:text-slate-400">
                              {user.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <Badge variant={user.role === 'ADMIN' ? 'default' : 'secondary'}>
                          {user.role === 'ADMIN' ? (
                            <Shield className="mr-1 h-3 w-3" />
                          ) : (
                            <Eye className="mr-1 h-3 w-3" />
                          )}
                          {user.role.toLowerCase()}
                        </Badge>
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">
                        {formatDate(user.lastLoginAt)}
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">
                        {formatDate(user.createdAt)}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => openEditDialog(user)}
                            aria-label={`Edit ${user.firstName} ${user.lastName}`}
                          >
                            <Pencil className="h-4 w-4" />
                            Edit
                          </Button>
                          <DropdownMenu
                            open={openActionMenuUserId === user.id}
                            onOpenChange={(open) => setOpenActionMenuUserId(open ? user.id : null)}
                          >
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-9 gap-1 px-2"
                                aria-label={`More actions for ${user.firstName} ${user.lastName}`}
                                title={`More actions for ${user.firstName} ${user.lastName}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                                More
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  setOpenActionMenuUserId(null);
                                  setEmailTarget(user);
                                  setEmailSubject('');
                                  setEmailBody('');
                                  setEmailError(null);
                                }}
                              >
                                <Mail className="mr-2 h-4 w-4" />
                                Send Email
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setOpenActionMenuUserId(null);
                                  const newRole = user.role === 'ADMIN' ? 'VIEWER' : 'ADMIN';
                                  setConfirmAction({
                                    title: 'Change Role',
                                    description: `Change ${user.firstName} ${user.lastName}'s role to ${newRole.toLowerCase()}?`,
                                    onConfirm: async () => {
                                      try {
                                        const res = await fetch(`/api/users/${user.id}`, {
                                          method: 'PATCH',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ role: newRole }),
                                          credentials: 'include',
                                        });
                                        if (res.ok) {
                                          const data = await res.json().catch(() => ({}));
                                          if (data.selfSessionInvalidated) {
                                            // Demoting yourself ends your session;
                                            // re-authenticate instead of staying on a
                                            // stale admin shell.
                                            window.location.href = '/auth/login';
                                            return;
                                          }
                                          fetchUsers();
                                        }
                                      } catch (err) {
                                        console.error('Failed to change role:', err);
                                      }
                                    },
                                  });
                                }}
                              >
                                <Shield className="mr-2 h-4 w-4" />
                                Change to {user.role === 'ADMIN' ? 'Viewer' : 'Admin'}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setOpenActionMenuUserId(null);
                                  setConfirmAction({
                                    title: 'Reset Password',
                                    description: `Send a password reset email to ${user.email}? They set a new password themselves; you never see it.`,
                                    onConfirm: async () => {
                                      try {
                                        const res = await fetch(
                                          `/api/users/${user.id}/reset-password`,
                                          { method: 'POST', credentials: 'include' }
                                        );
                                        if (res.ok) {
                                          toast({
                                            title: 'Password reset sent',
                                            description: `A reset email was sent to ${user.email}.`,
                                          });
                                        } else {
                                          const data = await res.json().catch(() => ({}));
                                          toast({
                                            title: 'Could not send reset',
                                            description: data.error || 'Please try again.',
                                            variant: 'destructive',
                                          });
                                        }
                                      } catch (err) {
                                        console.error('Failed to send password reset:', err);
                                        toast({
                                          title: 'Could not send reset',
                                          description: 'Please try again.',
                                          variant: 'destructive',
                                        });
                                      }
                                    },
                                  });
                                }}
                              >
                                <KeyRound className="mr-2 h-4 w-4" />
                                Reset Password
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-danger-600"
                                onClick={() => {
                                  setOpenActionMenuUserId(null);
                                  setConfirmAction({
                                    title: 'Archive from organization',
                                    description: `Remove ${user.firstName} ${user.lastName}'s access to this organization and its rooms? Their account and access in other organizations will not be changed.`,
                                    onConfirm: async () => {
                                      try {
                                        const res = await fetch(`/api/users/${user.id}`, {
                                          method: 'DELETE',
                                          credentials: 'include',
                                        });
                                        if (res.ok) {
                                          fetchUsers();
                                        }
                                      } catch (err) {
                                        console.error('Failed to remove user:', err);
                                      }
                                    },
                                  });
                                }}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Archive from organization
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {pendingInvites
                    .filter((inv) => inv.email.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((inv) => (
                      <tr
                        key={`invite-${inv.id}`}
                        className="border-b border-slate-200/70 last:border-0 dark:border-slate-800"
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <UserAvatar name={inv.email} size="sm" />
                            <div>
                              <div className="flex items-center gap-2 font-medium text-slate-950 dark:text-white">
                                {inv.email}
                                <Badge
                                  variant="outline"
                                  className="border-amber-300 text-xs text-amber-700 dark:border-amber-700 dark:text-amber-400"
                                >
                                  Pending Invite
                                </Badge>
                              </div>
                              <div className="text-sm text-slate-500 dark:text-slate-400">
                                Awaiting registration
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <Badge variant={inv.role === 'ADMIN' ? 'default' : 'secondary'}>
                            {inv.role === 'ADMIN' ? (
                              <Shield className="mr-1 h-3 w-3" />
                            ) : (
                              <Eye className="mr-1 h-3 w-3" />
                            )}
                            {inv.role.toLowerCase()}
                          </Badge>
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-400 dark:text-slate-500">—</td>
                        <td className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">
                          Invited {formatDate(inv.createdAt)}
                        </td>
                        <td className="px-5 py-4"></td>
                      </tr>
                    ))}
                  {viewerLinkInvites
                    .filter(
                      (vl) =>
                        vl.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        (vl.inviteeName ?? '').toLowerCase().includes(searchQuery.toLowerCase())
                    )
                    .map((vl) => {
                      const displayName = vl.inviteeName || vl.email;
                      const subtitle = vl.roomName
                        ? `${vl.inviteeCompany ? vl.inviteeCompany + ' · ' : ''}${vl.roomName}`
                        : (vl.inviteeCompany ?? 'Data room viewer');
                      return (
                        <tr
                          key={`viewer-link-${vl.id}`}
                          className="border-b border-slate-200/70 last:border-0 dark:border-slate-800"
                        >
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              <UserAvatar name={displayName} size="sm" />
                              <div>
                                <div className="flex items-center gap-2 font-medium text-slate-950 dark:text-white">
                                  {displayName}
                                  <Badge
                                    variant="outline"
                                    className="border-blue-300 text-xs text-blue-700 dark:border-blue-700 dark:text-blue-400"
                                  >
                                    <Link2 className="mr-1 h-3 w-3" />
                                    {vl.status === 'opened' ? 'Viewed' : 'Pending Viewer'}
                                  </Badge>
                                </div>
                                <div className="text-sm text-slate-500 dark:text-slate-400">
                                  {vl.email !== displayName && (
                                    <span className="mr-2">{vl.email}</span>
                                  )}
                                  {subtitle}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <Badge variant="secondary">
                              <Eye className="mr-1 h-3 w-3" />
                              viewer link
                            </Badge>
                          </td>
                          <td className="px-5 py-4 text-sm text-slate-400 dark:text-slate-500">
                            —
                          </td>
                          <td className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">
                            Invited {formatDate(vl.createdAt)}
                          </td>
                          <td className="px-5 py-4">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              aria-label="Go to room"
                              onClick={() => {
                                if (vl.roomId) {
                                  window.location.href = `/rooms/${vl.roomId}?manage=links`;
                                }
                              }}
                              disabled={!vl.roomId}
                            >
                              <Link2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </AdminSurface>
        )}
      </AdminPageContent>

      {/* Edit User Dialog */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditTarget(null);
            setEditError(null);
          }
        }}
      >
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-xl grid-rows-[auto_minmax(0,1fr)_auto]">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update this member&apos;s details, role, and status. Changing email, role, or status
              signs the user out of any active sessions.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 space-y-4 overflow-y-auto py-4 pr-1">
            {editError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                {editError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-first">First name</Label>
                <Input
                  id="edit-first"
                  value={editData.firstName}
                  onChange={(e) => {
                    setEditData({ ...editData, firstName: e.target.value });
                    setEditError(null);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-last">Last name</Label>
                <Input
                  id="edit-last"
                  value={editData.lastName}
                  onChange={(e) => {
                    setEditData({ ...editData, lastName: e.target.value });
                    setEditError(null);
                  }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                type="email"
                value={editData.email}
                onChange={(e) => {
                  setEditData({ ...editData, email: e.target.value });
                  setEditError(null);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role">Role</Label>
              <Select
                value={editData.role}
                onValueChange={(value) =>
                  setEditData({ ...editData, role: value as 'ADMIN' | 'VIEWER' })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4" />
                      Admin
                    </div>
                  </SelectItem>
                  <SelectItem value="VIEWER">
                    <div className="flex items-center gap-2">
                      <Eye className="h-4 w-4" />
                      Viewer
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-status">Status</Label>
              <Select
                value={editData.isActive ? 'active' : 'inactive'}
                onValueChange={(value) =>
                  setEditData({ ...editData, isActive: value === 'active' })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div>
                <Label>Profile and compliance</Label>
                <p className="mt-1 text-xs text-neutral-500">
                  Organization-specific information. It does not change room permissions or any
                  membership in another organization.
                </p>
              </div>
              {isProfileLoading ? (
                <p className="text-sm text-neutral-500">Loading profile…</p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="edit-company">Company</Label>
                    <Input
                      id="edit-company"
                      value={membershipProfile.company}
                      onChange={(event) =>
                        setMembershipProfile((current) => ({
                          ...current,
                          company: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-phone">Phone</Label>
                    <Input
                      id="edit-phone"
                      type="tel"
                      placeholder="+15551234567"
                      value={membershipProfile.phone}
                      onChange={(event) =>
                        setMembershipProfile((current) => ({
                          ...current,
                          phone: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-user-type">Relationship type</Label>
                    <Select
                      value={membershipProfile.organizationUserType ?? 'UNSPECIFIED'}
                      onValueChange={(value) =>
                        setMembershipProfile((current) => ({
                          ...current,
                          organizationUserType:
                            value === 'UNSPECIFIED' ? null : (value as OrganizationUserType),
                        }))
                      }
                    >
                      <SelectTrigger id="edit-user-type">
                        <SelectValue placeholder="Select a type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="UNSPECIFIED">Not specified</SelectItem>
                        <SelectItem value="FOUNDER">Founder</SelectItem>
                        <SelectItem value="INVESTOR">Investor</SelectItem>
                        <SelectItem value="PARTNER">Partner</SelectItem>
                        <SelectItem value="INVESTOR_REPRESENTATIVE">
                          Investor representative
                        </SelectItem>
                        <SelectItem value="EMPLOYEE">Employee</SelectItem>
                        <SelectItem value="CONSULTANT">Consultant</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="edit-nda-on-file"
                        checked={membershipProfile.ndaOnFile}
                        onCheckedChange={(checked) =>
                          setMembershipProfile((current) => ({
                            ...current,
                            ndaOnFile: checked === true,
                            ndaOnFileReference: checked === true ? current.ndaOnFileReference : '',
                          }))
                        }
                      />
                      <label htmlFor="edit-nda-on-file" className="cursor-pointer text-sm">
                        <span className="font-medium">Executed NDA on file</span>
                        <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-300">
                          This permits a signed-in member of this organization to pass a share-link
                          NDA gate without re-accepting it. An email entered into a public link is
                          never enough to use this status.
                        </span>
                      </label>
                    </div>
                    {membershipProfile.ndaOnFile && (
                      <div className="pt-2">
                        <Label htmlFor="edit-nda-reference">NDA reference</Label>
                        <Input
                          id="edit-nda-reference"
                          className="mt-2"
                          value={membershipProfile.ndaOnFileReference}
                          onChange={(event) =>
                            setMembershipProfile((current) => ({
                              ...current,
                              ndaOnFileReference: event.target.value,
                            }))
                          }
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <Label>Direct room access</Label>
              <p className="text-xs text-neutral-500">
                Viewer access is limited to the rooms selected here. Removing a room also removes
                this member&apos;s direct folder and document grants in that room. Access inherited
                through a group or room-admin assignment is identified separately and is not changed
                here.
              </p>
              {editTarget && editTarget.role !== editData.role ? (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Save the role change first, then reopen Edit User to manage this member&apos;s
                  direct room access.
                </p>
              ) : editData.role === 'ADMIN' ? (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Organization administrators already have access to every room. Change the role to
                  Viewer and save before assigning room-specific access.
                </p>
              ) : isRoomAccessLoading ? (
                <p className="text-sm text-neutral-500">Loading room access…</p>
              ) : roomAccessRestriction ? (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  {roomAccessRestriction}
                </p>
              ) : memberRoomAccess.length === 0 ? (
                <p className="text-sm text-neutral-500">There are no active data rooms.</p>
              ) : (
                <div className="max-h-48 space-y-2 overflow-y-auto pt-1">
                  {memberRoomAccess.map((room) => {
                    const checked = selectedDirectRoomIds.includes(room.id);
                    return (
                      <div key={room.id} className="flex items-start gap-3">
                        <Checkbox
                          id={`edit-room-${room.id}`}
                          checked={checked}
                          onCheckedChange={(nextChecked) => {
                            setSelectedDirectRoomIds((current) =>
                              nextChecked
                                ? [...current, room.id]
                                : current.filter((id) => id !== room.id)
                            );
                          }}
                        />
                        <label
                          htmlFor={`edit-room-${room.id}`}
                          className="cursor-pointer text-sm leading-5 text-neutral-700 dark:text-neutral-300"
                        >
                          <span className="font-medium">{room.name}</span>
                          <Badge
                            variant={room.effectiveAccess === 'NONE' ? 'outline' : 'secondary'}
                            className="ml-2"
                          >
                            {room.effectiveAccess === 'ADMIN'
                              ? 'Room admin'
                              : room.effectiveAccess === 'DOWNLOAD'
                                ? 'Download'
                                : room.effectiveAccess === 'VIEW'
                                  ? 'View'
                                  : room.effectiveAccess === 'SCOPED'
                                    ? 'Scoped access'
                                    : 'No access'}
                          </Badge>
                          {room.directRoomGrantLevel && (
                            <span className="ml-2 text-xs text-neutral-500">
                              Direct: {room.directRoomGrantLevel.toLowerCase()}
                            </span>
                          )}
                          {room.description && (
                            <span className="block text-xs text-neutral-500">
                              {room.description}
                            </span>
                          )}
                          {!!room.indirectAllowSources?.length && (
                            <span className="block text-xs text-amber-700 dark:text-amber-300">
                              Also granted through{' '}
                              {room.indirectAllowSources
                                .map((source) =>
                                  source === 'ROOM_ADMIN'
                                    ? 'a room-admin assignment'
                                    : 'a group membership'
                                )
                                .join(' and ')}
                              .
                            </span>
                          )}
                          {!!room.indirectDenySources?.length && (
                            <span className="block text-xs text-danger-700 dark:text-danger-300">
                              Access is explicitly denied through{' '}
                              {room.indirectDenySources
                                .map((source) =>
                                  source === 'DIRECT' ? 'a direct grant' : 'a group grant'
                                )
                                .join(' and ')}
                              .
                            </span>
                          )}
                          {!!room.directScopedGrantCount && (
                            <span className="block text-xs text-amber-700 dark:text-amber-300">
                              {checked
                                ? `${room.directScopedGrantCount} direct folder or document grant${room.directScopedGrantCount === 1 ? '' : 's'} will also be revoked when direct room access is removed.`
                                : `${room.directScopedGrantCount} direct folder or document grant${room.directScopedGrantCount === 1 ? '' : 's'} are managed separately.`}
                            </span>
                          )}
                          {!!room.indirectScopedGrantCount && (
                            <span className="block text-xs text-amber-700 dark:text-amber-300">
                              {room.indirectScopedGrantCount} folder or document grant
                              {room.indirectScopedGrantCount === 1 ? '' : 's'} are accessible
                              through a group membership. This room-level editor does not change
                              that access.
                            </span>
                          )}
                        </label>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              loading={isSavingEdit}
              disabled={isProfileLoading || isRoomAccessLoading}
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Email (platform message) Dialog */}
      <Dialog
        open={emailTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEmailTarget(null);
            setEmailError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Email</DialogTitle>
            <DialogDescription>
              Sent from your organization&apos;s address via VaultSpace
              {emailTarget ? ` to ${emailTarget.email}` : ''}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {emailError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                {emailError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email-subject">Subject</Label>
              <Input
                id="email-subject"
                value={emailSubject}
                onChange={(e) => {
                  setEmailSubject(e.target.value);
                  setEmailError(null);
                }}
                placeholder="Subject"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email-body">Message</Label>
              <textarea
                id="email-body"
                value={emailBody}
                onChange={(e) => {
                  setEmailBody(e.target.value);
                  setEmailError(null);
                }}
                rows={6}
                placeholder="Write your message…"
                className="border-input focus-visible:ring-ring flex min-h-[120px] w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSendEmail}
              loading={isSendingEmail}
              disabled={!emailSubject.trim() || !emailBody.trim()}
            >
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite User Dialog */}
      <Dialog
        open={showInviteDialog}
        onOpenChange={(open) => {
          setShowInviteDialog(open);
          if (!open) {
            setInviteError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite User</DialogTitle>
            <DialogDescription>
              Send an invitation email to add a new team member.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {inviteError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                {inviteError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="invite-first-name">First name</Label>
                <Input
                  id="invite-first-name"
                  value={inviteData.firstName}
                  onChange={(event) =>
                    setInviteData({ ...inviteData, firstName: event.target.value })
                  }
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-last-name">Last name</Label>
                <Input
                  id="invite-last-name"
                  value={inviteData.lastName}
                  onChange={(event) =>
                    setInviteData({ ...inviteData, lastName: event.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="colleague@example.com"
                value={inviteData.email}
                onChange={(e) => {
                  setInviteData({ ...inviteData, email: e.target.value });
                  setInviteError(null);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-company">Company</Label>
              <Input
                id="invite-company"
                value={inviteData.company}
                onChange={(event) => setInviteData({ ...inviteData, company: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-phone">Phone</Label>
              <Input
                id="invite-phone"
                type="tel"
                placeholder="+15551234567"
                value={inviteData.phone}
                onChange={(event) => setInviteData({ ...inviteData, phone: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-user-type">Relationship type</Label>
              <Select
                value={inviteData.userType ?? 'UNSPECIFIED'}
                onValueChange={(value) =>
                  setInviteData({
                    ...inviteData,
                    userType: value === 'UNSPECIFIED' ? null : (value as OrganizationUserType),
                  })
                }
              >
                <SelectTrigger id="invite-user-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNSPECIFIED">Not specified</SelectItem>
                  <SelectItem value="FOUNDER">Founder</SelectItem>
                  <SelectItem value="INVESTOR">Investor</SelectItem>
                  <SelectItem value="PARTNER">Partner</SelectItem>
                  <SelectItem value="INVESTOR_REPRESENTATIVE">Investor representative</SelectItem>
                  <SelectItem value="EMPLOYEE">Employee</SelectItem>
                  <SelectItem value="CONSULTANT">Consultant</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="invite-nda-on-file"
                  checked={inviteData.ndaOnFile}
                  onCheckedChange={(checked) =>
                    setInviteData({
                      ...inviteData,
                      ndaOnFile: checked === true,
                      ndaOnFileReference: checked === true ? inviteData.ndaOnFileReference : '',
                    })
                  }
                />
                <label htmlFor="invite-nda-on-file" className="cursor-pointer text-sm">
                  <span className="font-medium">Executed NDA on file</span>
                  <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-300">
                    Store this organization-specific compliance status with the invitation.
                  </span>
                </label>
              </div>
              {inviteData.ndaOnFile && (
                <div className="pt-2">
                  <Label htmlFor="invite-nda-reference">NDA reference</Label>
                  <Input
                    id="invite-nda-reference"
                    className="mt-2"
                    value={inviteData.ndaOnFileReference}
                    onChange={(event) =>
                      setInviteData({ ...inviteData, ndaOnFileReference: event.target.value })
                    }
                  />
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select
                value={inviteData.role}
                onValueChange={(value) =>
                  setInviteData({
                    ...inviteData,
                    role: value as 'ADMIN' | 'VIEWER',
                    roomIds: value === 'ADMIN' ? [] : inviteData.roomIds,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4" />
                      Admin - Full access to all rooms and settings
                    </div>
                  </SelectItem>
                  <SelectItem value="VIEWER">
                    <div className="flex items-center gap-2">
                      <Eye className="h-4 w-4" />
                      Viewer - View access to assigned rooms
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {inviteData.role === 'VIEWER' && (
              <div className="space-y-2">
                <Label>Assigned Data Rooms</Label>
                <p className="text-xs text-neutral-500">
                  Viewers can access only the rooms selected here.
                </p>
                {assignableRooms.length === 0 ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    No active data rooms are available. Create or activate a room before inviting a
                    viewer.
                  </div>
                ) : assignableRooms.length === 1 ? (
                  <div className="rounded-md border border-primary-200 bg-primary-50 p-3 text-sm text-primary-800 dark:border-primary-900 dark:bg-primary-950/30 dark:text-primary-200">
                    <span className="font-medium">{assignableRooms[0]?.name}</span> is the
                    organization&apos;s only active data room and will be assigned automatically.
                  </div>
                ) : (
                  <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-neutral-200 p-3">
                    {assignableRooms.map((room) => {
                      const checked = inviteData.roomIds.includes(room.id);
                      return (
                        <div key={room.id} className="flex items-start gap-3">
                          <Checkbox
                            id={`invite-room-${room.id}`}
                            checked={checked}
                            onCheckedChange={(nextChecked) => {
                              setInviteData((current) => ({
                                ...current,
                                roomIds: nextChecked
                                  ? [...current.roomIds, room.id]
                                  : current.roomIds.filter((id) => id !== room.id),
                              }));
                              setInviteError(null);
                            }}
                          />
                          <label
                            htmlFor={`invite-room-${room.id}`}
                            className="cursor-pointer text-sm leading-5 text-neutral-700"
                          >
                            <span className="font-medium">{room.name}</span>
                            {room.description && (
                              <span className="block text-xs text-neutral-500">
                                {room.description}
                              </span>
                            )}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInviteDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleInvite}
              loading={isInviting}
              disabled={
                !inviteData.email.trim() ||
                (inviteData.role === 'VIEWER' &&
                  assignableRooms.length !== 1 &&
                  inviteData.roomIds.length === 0)
              }
            >
              Send Invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmAction(null);
          }
        }}
        title={confirmAction?.title ?? ''}
        description={confirmAction?.description ?? ''}
        confirmLabel={confirmAction?.title === 'Remove User' ? 'Remove' : 'Confirm'}
        variant={confirmAction?.title === 'Remove User' ? 'destructive' : 'default'}
        onConfirm={async () => {
          if (confirmAction) {
            await confirmAction.onConfirm();
            setConfirmAction(null);
          }
        }}
      />
    </>
  );
}
