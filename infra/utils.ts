export const enumerate = (count: number) => Array.from({ length: count }, (_, i) => i)

export const generateServerName = (group: string, i: number) =>
  `${group}-` + i.toString().padStart(2, '0')
