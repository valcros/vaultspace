import { PageHeader } from '@/components/layout/page-header';
import { AdminPageContent } from '@/components/layout/admin-page';
import { FolderTemplateManagement } from '@/components/rooms/FolderTemplateManagement';

export default function OrganizationFolderTemplatesPage() {
  return (
    <>
      <PageHeader
        title="Organization folder templates"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Folder templates' }]}
      />
      <AdminPageContent>
        <FolderTemplateManagement />
      </AdminPageContent>
    </>
  );
}
