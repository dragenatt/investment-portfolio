'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'

type TourStep = {
  title: string
  description: string
  targetSelector: string | null
  position: 'center' | 'bottom' | 'top' | 'left' | 'right'
}

const TOUR_STEPS: TourStep[] = [
  {
    title: '¡Bienvenido a InvestTracker!',
    description:
      'Te guiaremos por las funciones principales de la plataforma para que puedas sacarle el máximo provecho.',
    targetSelector: null,
    position: 'center',
  },
  {
    title: 'Resumen del portafolio',
    description:
      'Aquí ves el valor total de tu portafolio y tu rendimiento.',
    targetSelector: '[data-tour="hero-section"]',
    position: 'bottom',
  },
  {
    title: 'Gráfica de rendimiento',
    description:
      'Esta gráfica muestra cómo ha crecido tu inversión. Usa los botones para cambiar el período.',
    targetSelector: '[data-tour="portfolio-chart"]',
    position: 'bottom',
  },
  {
    title: 'Navegación',
    description:
      'Navega entre las secciones: Mercados para explorar acciones, Portafolios para ver tus inversiones, y Watchlist para seguir activos.',
    targetSelector: 'aside',
    position: 'right',
  },
  {
    title: 'Búsqueda rápida',
    description: 'Usa Ctrl+K para buscar cualquier acción, ETF o crypto.',
    targetSelector: 'header',
    position: 'bottom',
  },
  {
    title: '¡Listo!',
    description:
      'Ya puedes empezar. Explora el mercado y agrega tu primera inversión. ¡Éxito!',
    targetSelector: null,
    position: 'center',
  },
]

const STORAGE_KEY = 'onboarding_completed'

type OnboardingTourProps = {
  forceOpen?: boolean
  onClose?: () => void
}

export function OnboardingTour({ forceOpen, onClose }: OnboardingTourProps) {
  const [isActive, setIsActive] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null)
  const [isAnimating, setIsAnimating] = useState(false)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const step = TOUR_STEPS[currentStep]
  const isFirst = currentStep === 0
  const isLast = currentStep === TOUR_STEPS.length - 1
  const isCentered = step.targetSelector === null

  // Check if tour should show
  useEffect(() => {
    if (forceOpen) {
      setIsActive(true)
      setCurrentStep(0)
      return
    }
    try {
      const completed = localStorage.getItem(STORAGE_KEY)
      if (!completed) {
        setIsActive(true)
      }
    } catch {
      // localStorage unavailable
    }
  }, [forceOpen])

  // Calculate spotlight position
  const updateSpotlight = useCallback(() => {
    if (!step.targetSelector) {
      setSpotlightRect(null)
      return
    }
    const el = document.querySelector(step.targetSelector)
    if (el) {
      const rect = el.getBoundingClientRect()
      setSpotlightRect(rect)
    } else {
      setSpotlightRect(null)
    }
  }, [step.targetSelector])

  useEffect(() => {
    if (!isActive) return
    setIsAnimating(true)
    const timer = setTimeout(() => {
      updateSpotlight()
      setIsAnimating(false)
    }, 50)

    window.addEventListener('resize', updateSpotlight)
    window.addEventListener('scroll', updateSpotlight, true)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', updateSpotlight)
      window.removeEventListener('scroll', updateSpotlight, true)
    }
  }, [isActive, currentStep, updateSpotlight])

  const completeTour = useCallback(() => {
    setIsActive(false)
    try {
      localStorage.setItem(STORAGE_KEY, 'true')
    } catch {
      // localStorage unavailable
    }
    onClose?.()
  }, [onClose])

  const handleNext = () => {
    if (isLast) {
      completeTour()
    } else {
      setCurrentStep((s) => s + 1)
    }
  }

  const handlePrev = () => {
    if (!isFirst) {
      setCurrentStep((s) => s - 1)
    }
  }

  const handleSkip = () => {
    completeTour()
  }

  // Keyboard navigation
  useEffect(() => {
    if (!isActive) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleSkip()
      if (e.key === 'ArrowRight') handleNext()
      if (e.key === 'ArrowLeft') handlePrev()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, currentStep])

  if (!isActive) return null

  // Compute tooltip position
  const getTooltipStyle = (): React.CSSProperties => {
    if (isCentered || !spotlightRect) {
      return {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      }
    }

    const padding = 16
    const tooltipWidth = 360
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight

    let top = 0
    let left = 0

    switch (step.position) {
      case 'bottom':
        top = spotlightRect.bottom + padding
        left = spotlightRect.left + spotlightRect.width / 2 - tooltipWidth / 2
        break
      case 'top':
        top = spotlightRect.top - padding
        left = spotlightRect.left + spotlightRect.width / 2 - tooltipWidth / 2
        break
      case 'right':
        top = spotlightRect.top + spotlightRect.height / 2
        left = spotlightRect.right + padding
        break
      case 'left':
        top = spotlightRect.top + spotlightRect.height / 2
        left = spotlightRect.left - padding - tooltipWidth
        break
    }

    // Clamp within viewport
    if (left < padding) left = padding
    if (left + tooltipWidth > viewportW - padding) left = viewportW - padding - tooltipWidth
    if (top < padding) top = padding
    if (top > viewportH - 200) top = viewportH - 200

    // On small screens, center horizontally
    if (viewportW < 640) {
      left = viewportW / 2 - tooltipWidth / 2
      if (left < 8) left = 8
    }

    return {
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
    }
  }

  const spotlightPadding = 8

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
      }}
    >
      {/* Dark overlay - covers entire screen */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'auto',
        }}
        onClick={handleSkip}
      >
        {/* If there's a target, render the spotlight hole using box-shadow */}
        {spotlightRect && !isCentered ? (
          <div
            style={{
              position: 'absolute',
              top: spotlightRect.top - spotlightPadding,
              left: spotlightRect.left - spotlightPadding,
              width: spotlightRect.width + spotlightPadding * 2,
              height: spotlightRect.height + spotlightPadding * 2,
              borderRadius: '12px',
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.7)',
              transition: 'all 0.3s ease',
              pointerEvents: 'none',
            }}
          />
        ) : (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              transition: 'opacity 0.3s ease',
            }}
          />
        )}
      </div>

      {/* Tooltip card */}
      <div
        ref={tooltipRef}
        style={{
          ...getTooltipStyle(),
          zIndex: 10000,
          pointerEvents: 'auto',
          maxWidth: isCentered ? '420px' : '360px',
          width: isCentered ? '90vw' : undefined,
          opacity: isAnimating ? 0 : 1,
          transition: 'opacity 0.2s ease, top 0.3s ease, left 0.3s ease',
        }}
        className="bg-card border border-border rounded-2xl shadow-2xl"
      >
        {/* Close button */}
        <button
          onClick={handleSkip}
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Cerrar tutorial"
        >
          <X className="h-4 w-4" />
        </button>

        <div className={`p-6 ${isCentered ? 'text-center' : ''}`}>
          {/* Step indicator */}
          {!isCentered && (
            <span className="text-xs text-muted-foreground font-medium mb-2 block">
              Paso {currentStep + 1} de {TOUR_STEPS.length}
            </span>
          )}

          <h3 className="text-lg font-semibold text-foreground mb-2">
            {step.title}
          </h3>

          <p className="text-sm text-muted-foreground leading-relaxed mb-5">
            {step.description}
          </p>

          {/* Progress dots */}
          <div className="flex items-center justify-center gap-1.5 mb-5">
            {TOUR_STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === currentStep
                    ? 'w-6 bg-primary'
                    : i < currentStep
                      ? 'w-1.5 bg-primary/40'
                      : 'w-1.5 bg-muted-foreground/30'
                }`}
              />
            ))}
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-between gap-2">
            {!isFirst && !isLast ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePrev}
                className="rounded-xl"
              >
                Anterior
              </Button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              {!isLast && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSkip}
                  className="rounded-xl text-muted-foreground"
                >
                  Omitir
                </Button>
              )}
              <Button
                size="sm"
                onClick={handleNext}
                className="rounded-xl px-5"
              >
                {isLast ? 'Comenzar' : isFirst ? 'Empezar tour' : 'Siguiente'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
