/* eslint-disable react/display-name */
import { Textarea } from '@/components/ui/textarea.js'
import { cn } from '@/lib/utils'
import React, {
  type TextareaHTMLAttributes,
  forwardRef, useEffect, useImperativeHandle, useRef, useState
} from 'react'

interface CounterProps {
  count: number
  maxCount: number
}

const Counter: React.FC<CounterProps> = ({ count, maxCount }) => {
  const circumference = 2 * Math.PI * 20
  const percentage = count / maxCount
  const strokeDasharray = `${percentage * circumference} ${circumference}`

  const getStrokeColor = () => {
    if (percentage < 0.5) return 'limegreen'
    if (percentage < 0.75) return 'yellow'
    return 'red'
  }

  return (
    <svg height="20" width="20">
      <circle
        cx="10"
        cy="10"
        fill="none"
        r="5"
        stroke="lightgray" // Background circle color
        strokeWidth="2"
      />
      <circle
        cx="10"
        cy="10"
        fill="none"
        r="5"
        stroke={getStrokeColor()}
        strokeDasharray={strokeDasharray}
        strokeWidth="2"
        transform="rotate(-90 10 10)" // To start the progress from the top
      />
    </svg>
  )
}

interface TextInputProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string
}

export const TextInput = forwardRef<HTMLTextAreaElement | null, TextInputProps>((props, parentRef) => {
  const [count, setCount] = useState<number>(0)
  const internalRef = useRef<HTMLTextAreaElement | null>(null) // create an internal ref

  // Combine refs: use internal ref if parentRef is not provided
  useImperativeHandle(parentRef, () => internalRef.current!, [internalRef])

  useEffect(() => {
    const refCurrent = internalRef.current // use internal ref directly
    if (refCurrent) {
      refCurrent.style.height = (refCurrent.scrollHeight) + 'px'
    }
  }, [count])

  return (
    <div className={cn('rounded-md', props.className)}>
      <div className="group flex flex-col focus-within:ring-black overflow-hidden">
        <Textarea
          {...props}
          className="overflow-hidden focus-visible:ring-0 border-hidden resize-none bg-transparent placeholder:text-stone-400 invalid:border-red-500 !rounded-none"
          onChange={(e) => {
            setCount(e.target.value.length)
            if (props.onChange) { props.onChange(e) }
          }}
          ref={internalRef} // attach the internal ref
        />
        {props.maxLength && count > 0 && (
          <div className="flex items-center text-sm text-gray-400 gap-1 py-1 bg-transparent border-t-0 px-2 py-1">
            <Counter count={count} maxCount={props.maxLength} />
            {props.error ? <div className="text-red-300">{props.error}</div> : <div>{count}/{props.maxLength} characters</div>}
          </div>
        )}
      </div>
    </div>
  )
})
