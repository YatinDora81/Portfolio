export default function SectionHeading({
  subHeading,
  heading,
}: {
  subHeading: string;
  heading: string;
}) {
  return (
    <div>
      <p className="text-secondary text-sm">{subHeading}</p>
      <h2 className="text-2xl font-bold">{heading}</h2>
    </div>
  );
}
