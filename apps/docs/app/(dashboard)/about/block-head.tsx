export function BlockHead({ n, title, children, id }: {
  n: string;
  title: string;
  children?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="abt-h" id={id}>
      <div className="abt-h-r">
        <span className="abt-h-n">{n}</span>
        <h2 className="abt-h-t">{title}</h2>
      </div>
      {children && <p className="abt-h-d">{children}</p>}
    </div>
  );
}
