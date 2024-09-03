import { FileText } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from './ui/button.js'

export const SelectedFilesList = (
  {
    files,
    removeFiles
  }: {
    files: FileList | null,
    removeFiles: () => void
  }
) => {
  const [list, setList] = useState<string[]>([])

  useEffect(() => {
    const _files = []
    for (const file of files ?? []) {
      _files.push(file.name)
    }
    setList(_files)
  }, [files])

  return (
    <div className="flex flex-wrap items-center gap-2">

      {(list.map((name: string) => (
        <div className="flex items-center gap-1 m-2" key={name}>
          <FileText size={15} />
          <span className="text-sm font-semibold">{name}</span>
        </div>
      )))}

      {list.length > 0 && <Button
        className="border m-2"
        onClick={removeFiles}
        size="xs"
        variant="ghost"
      >Remove Files</Button>}
    </div>
  )
}