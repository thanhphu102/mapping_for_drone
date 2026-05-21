export type ImportScanPreviewResponse = {
  objectId: string
  floorId: string
  detectedRooms: number
  validRooms: number
  invalidRooms: number
  warnings: string[]
}

export async function previewScanJsonImport(): Promise<ImportScanPreviewResponse> {
  throw new Error('Not implemented yet')
}

