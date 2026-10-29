import { describe, expect, it } from 'vitest'
import { normalizeProductImageUrls } from './api'
import { cloudinaryImageUrl, cloudinaryVideoUrl } from './cloudinary'

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

describe('Cloudinary image delivery', () => {
  it('adds responsive automatic format and quality transformations', () => {
    expect(cloudinaryImageUrl('https://res.cloudinary.com/demo/image/upload/v123/products/tie.jpg', 640))
      .toBe('https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_640/v123/products/tie.jpg')
  })

  it('leaves legacy and non-image URLs unchanged', () => {
    expect(cloudinaryImageUrl('https://project.supabase.co/storage/v1/object/public/product-images/tie.jpg'))
      .toBe('https://project.supabase.co/storage/v1/object/public/product-images/tie.jpg')
    expect(cloudinaryImageUrl('https://res.cloudinary.com/demo/video/upload/hero.mp4'))
      .toBe('https://res.cloudinary.com/demo/video/upload/hero.mp4')
  })

  it('optimizes Cloudinary video delivery without changing legacy video URLs', () => {
    expect(cloudinaryVideoUrl('https://res.cloudinary.com/demo/video/upload/v1/hero.mp4', 900))
      .toBe('https://res.cloudinary.com/demo/video/upload/f_mp4,q_auto:good,c_limit,w_900/v1/hero.mp4')
    expect(cloudinaryVideoUrl('https://legacy.example/hero.mp4')).toBe('https://legacy.example/hero.mp4')
  })
})