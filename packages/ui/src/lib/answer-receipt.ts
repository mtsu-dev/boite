import type { QuestionOption } from '@boite/contracts';
import { fill, strings } from './strings';

/**
 * An answer in one line: the labels picked, then whatever was typed, else
 * how many files went. The folded card and the composer's receipt read it.
 */
export function answerSummary(options: QuestionOption[], optionIds: string[], text: string, files: number): string {
  const labels = optionIds.map((id) => options.find((one) => one.id === id)?.label ?? id);
  if (labels.length > 0 && text.length > 0) return `${labels.join(', ')}: ${text}`;
  const said = labels.length > 0 ? labels.join(', ') : text;
  return said.length > 0 || files === 0 ? said : fill(strings.media.answerFileCount, { count: String(files) });
}
