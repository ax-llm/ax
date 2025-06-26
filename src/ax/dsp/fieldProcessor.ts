import type { AxAIMemory } from '../mem/types.js'

import type { extractionState } from './extract.js'
import type { AxField } from './sig.js'
import type { AxFieldValue, AxGenOut } from './types.js'

export type AxFieldProcessorProcess = (
    value: AxFieldValue,
    context?: Readonly<{
        values?: AxGenOut
        sessionId?: string
        done?: boolean
    }>
) => unknown | Promise<unknown>

export type AxStreamingFieldProcessorProcess = (
    value: string,
    context?: Readonly<{
        values?: AxGenOut
        sessionId?: string
        done?: boolean
    }>
) => unknown | Promise<unknown>
export interface AxFieldProcessor {
    field: Readonly<AxField>

    /**
     * Process the field value and return a new value (or undefined if no update is needed).
     * The returned value may be merged back into memory.
     * @param value - The current field value.
     * @param context - Additional context (e.g. memory and session id).
     */
    process: AxFieldProcessorProcess | AxStreamingFieldProcessorProcess
}

/**
 * For synchronous responses: iterates over registered field processors,
 * passing in the current values. If a processor returns a new value,
 * that value is merged into memory with a special role ('processor').
 */
export async function processFieldProcessors(
    fieldProcessors: AxFieldProcessor[],
    values: AxGenOut,
    mem: AxAIMemory,
    sessionId?: string
) {
    for (const processor of fieldProcessors) {
        if (values[processor.field.name] === undefined) {
            continue
        }

        const processFn = processor.process as AxFieldProcessorProcess
        const result = await processFn(values[processor.field.name], {
            sessionId,
            values,
            done: true,
        })
        addToMemory(processor.field, mem, result, sessionId)
    }
}

/**
 * For streaming responses: processes each streaming field processor
 * and yields delta updates if they return new values.
 */
export async function processStreamingFieldProcessors(
    fieldProcessors: AxFieldProcessor[],
    content: string,
    xstate: Readonly<extractionState>,
    mem: AxAIMemory,
    values: AxGenOut,
    sessionId: string | undefined,
    done: boolean = false
): Promise<void> {
    for (const processor of fieldProcessors) {
        if (xstate.currField?.name !== processor.field.name) {
            continue
        }

        let value = content.substring(xstate.s)

        if (xstate.currField?.type?.name === 'code') {
            // remove markdown block
            value = value.replace(/^[ ]*```[a-zA-Z0-9]*\n\s*/, '')
            value = value.replace(/\s*```\s*$/, '')
        }
        const processFn = processor.process as AxStreamingFieldProcessorProcess
        const result = await processFn(value, {
            sessionId,
            values,
            done,
        })

        addToMemory(xstate.currField, mem, result, sessionId)
    }
}

const addToMemory = (
    field: Readonly<AxField>,
    mem: AxAIMemory,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result: any | any[],
    sessionId?: string
) => {
    if (
        result === undefined ||
        (typeof result === 'string' &&
            (result === '' || /^(null|undefined)\s*$/i.test(result)))
    ) {
        return
    }

    let resultText = JSON.stringify(
        result,
        (key, value) => (typeof value === 'bigint' ? Number(value) : value),
        2
    )

    const text = getFieldProcessingMessage(field, resultText)
    mem.add([{ role: 'user', content: [{ type: 'text', text }] }], sessionId)
    mem.addTag(`processor`, sessionId)
}

function getFieldProcessingMessage(
    field: Readonly<AxField>,
    resultText: string
) {
    const isCodeField = field.type?.name === 'code'
    const fieldTitle = field.title

    if (isCodeField) {
        return `Code in the field "${fieldTitle}" was executed. The code execution produced the following output: ${resultText}`
    } else {
        return `The field "${fieldTitle}" was processed. The field contents were transformed into the following output: ${resultText}`
    }
}
