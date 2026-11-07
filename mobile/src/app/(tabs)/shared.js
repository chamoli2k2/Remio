import FolderList from '../../components/FolderList';

const sharedWithMe = f => f.role && f.role !== 'owner';

export default function Shared() {
  return <FolderList eyebrow="YOUR WORKSPACE" title="Better, together." subtitle="Collections others have shared with you." path="/folders" filter={sharedWithMe}
    emptyTitle="Nothing shared yet" emptyText="When someone shares a folder with you, it shows up here." />;
}
