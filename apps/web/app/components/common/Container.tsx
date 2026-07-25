export default function Container({
  children,
  className = '',
  id,
}: {
  children: React.ReactNode;
  className?: string;
  /** Optional anchor target, e.g. the `#about` the hero's scroll cue links to. */
  id?: string;
}) {
  return (
    <div id={id} className={`mx-auto max-w-3xl px-4 sm:px-6 ${className}`}>
      {children}
    </div>
  );
}
