'use client'

import { HelpCircle } from 'lucide-react'
import {
  Tooltip,
  TooltipTrigger,
  TooltipPortal,
  TooltipPositioner,
  TooltipContent,
  TooltipArrow,
} from '@/components/ui/tooltip'

const TERMS: Record<string, string> = {
  'P/E': 'Price to Earnings — indica cuánto pagan los inversores por cada peso de ganancia. Un P/E alto puede significar que se espera crecimiento futuro.',
  'EPS': 'Earnings Per Share — ganancia neta dividida entre el número de acciones. Mayor EPS = más rentable.',
  'Market Cap': 'Capitalización de mercado — valor total de la empresa (precio × acciones en circulación).',
  'Dividend Yield': 'Rendimiento por dividendo — porcentaje anual que paga la empresa sobre el precio de la acción.',
  'RSI': 'Relative Strength Index — indicador de sobrecompra (>70) o sobreventa (<30).',
  'MACD': 'Moving Average Convergence Divergence — indica cambios en la fuerza y dirección de la tendencia.',
  'Volumen': 'Número de acciones negociadas en un período. Alto volumen = más interés.',
  '52-Week High/Low': 'Precio más alto y más bajo de la acción en los últimos 12 meses.',
  'Ganancia Total': 'Diferencia entre el valor actual de tus inversiones y lo que pagaste por ellas.',
  'Ganancia Hoy': 'Cambio en el valor de tus inversiones desde la apertura del mercado hoy.',
  'Precio Promedio': 'Precio promedio al que compraste tus acciones, incluyendo comisiones.',
  'Acciones Fraccionarias': 'Puedes comprar una fracción de una acción. Por ejemplo, 0.01 acciones de una acción de $300 = $3.',
  'Volatilidad': 'Medida de cuánto fluctúa el precio. Alta volatilidad = más riesgo pero también más oportunidad.',
  'Sharpe Ratio': 'Mide el rendimiento ajustado al riesgo. Mayor Sharpe = mejor rendimiento por unidad de riesgo.',
  'Max Drawdown': 'La mayor caída desde un máximo hasta un mínimo. Indica el peor escenario histórico.',
  'Comisión': 'Tarifa cobrada por el broker por ejecutar tu operación.',
  'Portafolio': 'Conjunto de inversiones agrupadas. Puedes tener varios portafolios con diferentes estrategias.',
  'Valor Invertido': 'Monto total que has invertido en este portafolio, sin contar ganancias ni pérdidas.',
  'G/P': 'Ganancia o Pérdida — la diferencia entre el valor actual y tu costo de compra.',
  'Retorno Simple': 'Ganancia directa sobre tu inversión — diferencia porcentual entre lo que invertiste y lo que vale ahora.',
  'TWR': 'Time-Weighted Return — rendimiento de la estrategia, sin importar depósitos o retiros.',
  'MWR': 'Money-Weighted Return — tu rendimiento real, considerando el timing de tus depósitos y retiros.',
  'Sortino Ratio': 'Similar al Sharpe pero solo penaliza la volatilidad negativa. Mayor Sortino = mejor manejo del riesgo a la baja.',
  'Calmar Ratio': 'Rendimiento anualizado dividido entre el max drawdown. Mayor Calmar = mejor recuperación de caídas.',
  'VaR 95%': 'Value at Risk — con 95% de confianza, la pérdida máxima diaria esperada.',
  'Beta': 'Sensibilidad al mercado. Beta > 1 = más volátil que el mercado, Beta < 1 = menos volátil.',
  'Alpha': 'Rendimiento extra sobre lo esperado dado el riesgo (beta). Alpha positivo = superas al mercado.',
  'Tracking Error': 'Desviación estándar de la diferencia de rendimientos entre tu portafolio y el benchmark.',
  'Information Ratio': 'Exceso de rendimiento por unidad de tracking error. Mayor = mejor rendimiento ajustado vs benchmark.',
  'Drawdown': 'Caída porcentual desde un máximo histórico hasta el punto más bajo antes de recuperarse.',
  'Atribucion BHB': 'Modelo Brinson-Hood-Beebower — descompone el exceso de rendimiento en efecto de asignación (peso por sector) y selección (qué acciones elegiste).',
  'Rendimiento Mensual': 'Retorno porcentual del portafolio en cada mes calendario.',
}

export function FinanceTooltip({ term }: { term: string }) {
  const explanation = TERMS[term]
  if (!explanation) return null

  return (
    <Tooltip>
      <TooltipTrigger
        className="inline-flex items-center justify-center h-4 w-4 rounded-full border border-muted-foreground/30 text-muted-foreground hover:text-foreground hover:border-foreground/50 transition-colors cursor-help"
        aria-label={`Ayuda: ${term}`}
      >
        <HelpCircle className="h-3 w-3" />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipPositioner side="top" sideOffset={6}>
          <TooltipContent className="max-w-[260px]">
            <TooltipArrow />
            <p className="font-medium text-xs mb-1">{term}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{explanation}</p>
          </TooltipContent>
        </TooltipPositioner>
      </TooltipPortal>
    </Tooltip>
  )
}
