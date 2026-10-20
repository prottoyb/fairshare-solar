// Smoke test for journeys J1–J3 (SPEC.md §7). Needs `npm.cmd run dev` running.
// It is the only test that starts the simulator timer.

function resetDemo() {
  cy.request('POST', '/api/simulator/stop')
  cy.request<{ id: string }[]>('/api/buildings')
    .its('body.0.id')
    .then((id: string) => {
      cy.request('PATCH', `/api/buildings/${id}`, { splitMode: 'EQUAL' })
    })
}

describe('FairShare Solar dashboard', () => {
  beforeEach(resetDemo)
  after(resetDemo)

  it('goes live, applies the split mode from the next interval, and goes stale when stopped', () => {
    cy.visit('/')
    cy.contains('h1', "Prottoy's Apartment")
    cy.contains('h2', 'Weather in Fawkner')

    // Start from a device that is not already online (a previous run may have
    // left it ONLINE for up to 3 intervals after stopping).
    cy.get('[data-testid="device-status"]', { timeout: 8000 }).should('not.contain', 'Online')

    // J1: start at 1 s per interval; the device comes online.
    cy.contains('label', 'Speed').find('select').select('1 s per interval')
    cy.get('[data-testid="sim-start"]').click()
    cy.get('[data-testid="device-status"]', { timeout: 5000 }).should('contain', 'Online')

    // J2: switch to entitlement; a later interval is split that way.
    cy.get('[data-testid="split-entitlement"]').check()
    cy.contains('Applies from the next interval')
    cy.get('[data-testid="live-split-mode"]', { timeout: 5000 }).should('have.text', 'ENTITLEMENT')

    // J3: stop; after 3 missed intervals the device is stale.
    cy.get('[data-testid="sim-stop"]').click()
    cy.get('[data-testid="device-status"]', { timeout: 8000 }).should('contain', 'Stale')
  })
})
