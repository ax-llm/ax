---
title: Functions Part 1
description: How to create functions to use in Ax
---

In this guide, we’ll explain how to create functions, function classes, etc. that can be used in Ax. Creation focused functions with clear names and descriptions are critical to a solid workflow. Do not use too many functions on a prompt or make the function itself do too much. Focused functions are better. If you need to use several functions, then look into breaking down the task into multiple prompts or using agents.

### Function definition simple

A function is an object with a `name`, and `description` along with a JSON schema of the function arguments and the function itself

```typescript
// The function
const googleSearchAPI = async (query: string) => {
    const res = await axios.get("http://google.com/?q=" + query)
    return res.json()
}
```

```typescript
// The function definition
const googleSearch AxFunction = {
    name: 'googleSearch',
    description: 'Use this function to search google for links related to the query',
    func: googleSearchAPI,
    parameters: {
        type: 'object',
         properties: {
             query: {
                description: `The query to search for`,
                type: 'string'
            },
        }
    }
}
```

### Function definition as a class

Another way to define functions is as a class with a `toFunction` method.

```typescript
class GoogleSearch {
    private apiKey: string;

    constructor(apiKey: string) {
        this.apiLey = apiKey;
    }


    async query(query: string) {
        const res = await axios.get("http://google.com/?q=" + query)
        return res.json()
    }

    async toFunction() {
        return {
            name: 'googleSearch',
            description: 'Use this function to search google for links related to the query',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        description: `The query to search for`,
                        type: 'string'
                    },
                }
            },
            func: (query: string) => this.query(query)
        }
    }
}
```


## How to use these functions

Just set the function on the prompt

```typescript
const prompt = new AxGen('inputs -> output', { functions: [ googleSearch ] })
```

Or in the case of function classes

```typescript
const prompt = new AxGen('inputs -> output', { functions: [ new GoogleSearch(apiKey) ] })
```