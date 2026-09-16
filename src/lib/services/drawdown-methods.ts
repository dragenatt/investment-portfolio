// Three ways to measure "the worst fall", named so they stop looking like a
// contradiction.
//
// A reader on the analytics page sees the worst drawdown three times, and gets
// three numbers: 8.72%, 8.2% and 8.7%, over two different date ranges. Every one
// is correct. They differ because they answer different questions:
//
//   - the VALUE series falls when the market falls and also when money leaves,
//     and it is what the underwater chart draws;
//   - the TIME-WEIGHTED index strips contributions and withdrawals out, so it
//     measures the strategy rather than the cash flow around it;
//   - REPRICING today's weights over the window asks what the book as it stands
//     now would have suffered, which is the only one of the three that says
//     anything about the portfolio the reader currently holds.
//
// Nothing here changes a calculation. The problem was never the arithmetic; it
// was three figures presented under one name, leaving the reader to conclude
// that something was broken.

export type DrawdownMethod = 'value' | 'timeWeighted' | 'currentWeights'

export type DrawdownMethodCopy = {
  /** Goes next to the figure, in parentheses. Short enough for a card label. */
  short: string
  /** One sentence: what this one measures, and why it can differ from the others. */
  explanation: string
}

export const DRAWDOWN_METHODS: Record<DrawdownMethod, DrawdownMethodCopy> = {
  value: {
    short: 'valor del portafolio',
    explanation:
      'Medida sobre el valor del portafolio, que baja tanto cuando el mercado cae como cuando sacas dinero. Puede diferir de las otras dos caídas máximas del análisis, que miden cosas distintas.',
  },
  timeWeighted: {
    short: 'rendimiento ponderado en el tiempo',
    explanation:
      'Medida sobre el rendimiento ponderado en el tiempo, que deja fuera aportaciones y retiros para aislar la estrategia. Puede diferir de las otras dos caídas máximas del análisis, que miden cosas distintas.',
  },
  currentWeights: {
    short: 'pesos actuales',
    explanation:
      'Medida repreciando el periodo con los pesos que el portafolio tiene hoy: qué habría sufrido la cartera tal como está ahora. Puede diferir de las otras dos caídas máximas del análisis, que miden cosas distintas.',
  },
}

/** Shown once where a reader can meet more than one of them. */
export const DRAWDOWN_METHODS_NOTE =
  'La "peor caída" no es una sola cifra: se puede medir sobre el valor del portafolio, sobre el rendimiento ponderado en el tiempo, o repreciando el periodo con los pesos actuales. Las tres son correctas y responden preguntas distintas, por eso cada una dice con qué método se calculó.'

/** "Caída máxima (valor del portafolio)" and friends. */
export function drawdownLabel(method: DrawdownMethod, base = 'Caída máxima'): string {
  return `${base} (${DRAWDOWN_METHODS[method].short})`
}
