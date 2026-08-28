export default function Container({
  children,
  className = '',
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div id={id} className={`mx-auto max-w-3xl px-4 sm:px-6 ${className}`}>
      {children}
    </div>
  );
}
