import type { Vec3 } from './case-contract.ts'

export type DecodedMesh = {
  readonly positions: Float32Array
  readonly bounds: { readonly min: Vec3; readonly max: Vec3 }
}

export function decodeBinaryStl(buffer: ArrayBuffer): DecodedMesh {
  const headerBytes = 84
  const triangleBytes = 50
  if (buffer.byteLength < headerBytes) throw new Error('Truncated binary STL header.')
  const view = new DataView(buffer)
  const triangleCount = view.getUint32(80, true)
  if (triangleCount === 0) throw new Error('Binary STL contains no triangles.')
  if (buffer.byteLength !== headerBytes + triangleCount * triangleBytes) {
    throw new Error('Binary STL length does not match its triangle count.')
  }

  const positions = new Float32Array(triangleCount * 9)
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let face = 0; face < triangleCount; face++) {
    // Skip the stored normal. The viewer can derive normals from the triangle winding.
    const vertexStart = headerBytes + face * triangleBytes + 12
    for (let component = 0; component < 9; component++) {
      const coordinate = view.getFloat32(vertexStart + component * 4, true)
      if (!Number.isFinite(coordinate)) throw new Error('Binary STL has a non-finite vertex.')
      positions[face * 9 + component] = coordinate
      const axis = component % 3
      min[axis] = Math.min(min[axis], coordinate)
      max[axis] = Math.max(max[axis], coordinate)
    }
  }
  return { positions, bounds: { min, max } }
}
