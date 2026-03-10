export default function Container({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto max-w-3xl px-4 sm:px-6 ${className}`}>
      {children}
    </div>
  );
}
