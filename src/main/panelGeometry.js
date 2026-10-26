export function panelGeometry(area, dock, requestedHeight) {
  const margin = Math.min(40, Math.max(0, area.height - 120))
  const minHeight = Math.min(120, area.height)
  const y = Math.max(0, Math.min(Number(dock.y) || 0, area.height - minHeight - margin))
  const height = Math.max(
    minHeight,
    Math.min(Number(requestedHeight) || minHeight, area.height - y - margin)
  )
  const width = Math.min(280, area.width)
  return {
    y: area.y + y,
    offsetY: y,
    height,
    width,
    shownX: dock.edge === 'left' ? area.x : area.x + area.width - width,
    hiddenX: dock.edge === 'left' ? area.x - width : area.x + area.width
  }
}
