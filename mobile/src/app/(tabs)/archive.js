import FolderList from '../../components/FolderList';

export default function Archive() {
  return <FolderList eyebrow="YOUR WORKSPACE" title="Archived folders" subtitle="Tucked away safely. Restore them anytime." path="/folders/archived"
    emptyTitle="Nothing archived" emptyText="Folders you archive on remio.in appear here." />;
}
