import type { Metadata } from 'next'

/** Every page's tab title ends with the product's name. */
export const TITLE_TEMPLATE = '%s · InvestTracker'

/**
 * The title metadata for a section's layout: its own name, and the template
 * passed on to the pages below it.
 *
 * A layout that sets `title` to a plain string ends the root's template there.
 * Next applies the template of the closest parent segment, and a string title
 * carries none, so every page one level deeper lost the brand: /market read
 * "Mercado · InvestTracker" and /market/VOO just "VOO". Repeating the template
 * in each section keeps it for any depth.
 */
export function sectionTitle(name: string): Metadata['title'] {
  return { default: name, template: TITLE_TEMPLATE }
}
