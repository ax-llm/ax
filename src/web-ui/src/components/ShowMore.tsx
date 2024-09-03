import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion'

export const ShowMore = ({ label, text }: { label: string, text: string }) => {
  return (
    <Accordion className="w-full" collapsible={true} type="single">
      <AccordionItem className="border-0" value="item-1">
        <AccordionTrigger className="text-sm text-stone-500">{label}</AccordionTrigger>
        <AccordionContent>{text}</AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
