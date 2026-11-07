import FolderList from '../../components/FolderList';

export default function Explore() {
  return <FolderList eyebrow="THE COMMUNITY LIBRARY" title="Follow your curiosity." subtitle="Public collections from other learners." path="/folders?scope=explore"
    emptyTitle="Nothing public yet" emptyText="Public collections will appear here." />;
}
