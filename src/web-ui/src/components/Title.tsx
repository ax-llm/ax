export const Title = ({ desc, text }: { desc: string, text: string }) => (
  <div className="mb-4 px-4 leading-3">
    <h1 className="text-lg font-semibold">{text}</h1>
    <h2 className="text-sm text-gray-700">{desc}</h2>
  </div>
)