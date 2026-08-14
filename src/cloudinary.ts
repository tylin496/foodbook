const CLOUD_NAME = 'm3p51nrf'
const UPLOAD_PRESET = 'food-diary'

const MAX_DIMENSION = 1600
const SKIP_COMPRESSION_BELOW_BYTES = 1_500_000
const JPEG_QUALITY = 0.82
const UPLOAD_TIMEOUT_MS = 20_000
const MAX_ATTEMPTS = 3

// Phone camera photos routinely land at 5-15MB, which times out easily on a
// flaky mobile connection. Downscale/re-encode before it ever hits the wire.
async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file
  if (file.size < SKIP_COMPRESSION_BELOW_BYTES) return file

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    // JPEG has no alpha, so transparent pixels would encode as black. Lay down
    // white first to match the card background a PNG cut-out is shown against.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })
  } catch {
    // Compression is a best-effort optimization — fall back to the original.
    return file
  }
}

async function uploadOnce(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('upload_preset', UPLOAD_PRESET)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)

  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Cloudinary upload failed: ${res.status} ${detail}`)
    }

    const data = (await res.json()) as { secure_url: string }
    return data.secure_url
  } finally {
    clearTimeout(timer)
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function uploadToCloudinary(file: File): Promise<string> {
  const uploadFile = await compressImage(file)

  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await uploadOnce(uploadFile)
    } catch (err) {
      lastError = err
      console.error(`Cloudinary upload attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err)
      if (attempt < MAX_ATTEMPTS) await sleep(500 * attempt)
    }
  }
  throw lastError
}
