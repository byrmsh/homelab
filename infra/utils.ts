export const enumerate = (count: number) => Array.from({ length: count }, (_, i) => i)

export const generateServerName = (group: string, i: number) =>
  `${group}-` + i.toString().padStart(2, '0')

export const fillTemplate = (template: string, replacements: Record<string, string>) =>
  Object.entries(replacements).reduce(
    (draft, [key, value]) => draft.replace(`[[${key}]]`, value),
    template,
  )
