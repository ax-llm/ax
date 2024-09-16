interface ProseProps {
  children: React.ReactNode;
}

export const Prose = ({ children }: ProseProps) => (
  <div
    className="prose prose-xl dark:prose-invert
  prose-h1:font-bold prose-h1:text-xl
  prose-a:text-blue-600 prose-p:text-justify prose-p:m-0 prose-img:rounded-xl
  prose-headings:underline p-0 m-0"
  >
    {children}
  </div>
);
