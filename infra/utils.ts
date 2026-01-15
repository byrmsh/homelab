import * as pulumi from '@pulumi/pulumi'

type PulumiValue<T> = T | pulumi.Output<T> | pulumi.Input<T>

export const enumerate = (count: number) => Array.from({ length: count }, (_, i) => i)

export const generateServerName = (group: string, i: number) =>
  `${group}-` + i.toString().padStart(2, '0')

export const indentOutputText = (text: PulumiValue<string>, spaceCount: number) =>
  pulumi.output(text).apply(t => t.split('\n').join(`\n${' '.repeat(spaceCount)}`))
