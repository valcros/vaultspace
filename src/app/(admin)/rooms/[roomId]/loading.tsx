import { Skeleton } from '@/components/ui/skeleton';

export default function RoomLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-40 rounded-xl" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
