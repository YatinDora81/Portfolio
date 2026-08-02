/**
 * The numbered rule that opens every block in section 02, on both of its routes.
 *
 * The cards below it are untouched `Card`s — the rhythm lives here instead, so
 * the two staged tables keep their exact markup (and therefore their exact
 * staging behaviour) while the page still reads as an ordered document rather
 * than a stack of widgets.
 */
export function BlockHead({ n, title, children, id }: {
  /** Ordinal within the page. Digits — the glyph ordinals belong to the nav. */
  n: string;
  title: string;
  /** One line saying what the block is for. */
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
