import { describe, expect, it } from 'vitest'
import { normalizeProductImageUrls } from './api'

describe('product image URL normalization', () => {
  it('keeps the primary image first and removes duplicate or blank gallery URLs', () => {
    expect(normalizeProductImageUrls(' https://images.example/new.jpg ', [
      'https://images.example/old.jpg',
      'https://images.example/new.jpg',
      '',
    ])).toEqual([
      'https://images.example/new.jpg',
      'https://images.example/old.jpg',
    ])
  })
})