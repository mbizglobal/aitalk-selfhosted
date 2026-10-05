import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcrypt'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        email: true,
        password: true // To check if user has password (not Google OAuth)
      }
    })

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    const billing = await prisma.billingInfo.findUnique({
      where: { id: session.user.id },
      select: { companyName: true, phone: true, companyCountry: true }
    })

    return NextResponse.json({
      success: true,
      user: {
        name: user.name,
        email: user.email,
        companyName: billing?.companyName ?? '',
        phone: billing?.phone ?? '',
        country: billing?.companyCountry ?? '',
        password: !!user.password // Boolean indicating if user has password
      }
    })

  } catch (error) {
    console.error('Error fetching user profile:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { name, email, companyName, phone, country, currentPassword, newPassword, timezone, locale, timeFormat } = await req.json()

    // Get current user data first
    const currentUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, password: true }
    })

    if (!currentUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Use current values if not provided (for Regional Settings only updates)
    const finalName = name || currentUser.name
    const finalEmail = email || currentUser.email

    // Validate name if provided
    if (name && typeof name !== 'string') {
      return NextResponse.json(
        { error: 'Invalid name format' },
        { status: 400 }
      )
    }

    // Email format validation only if email is being changed
    if (email && email !== currentUser.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(email)) {
        return NextResponse.json(
          { error: 'Invalid email format' },
          { status: 400 }
        )
      }
    }

    // Check if email is being changed (only allowed for non-Google users)
    if (email && email !== currentUser.email) {
      // If user doesn't have password, they're a Google user - can't change email
      if (!currentUser.password) {
        return NextResponse.json(
          { error: 'Email cannot be changed for Google accounts' },
          { status: 400 }
        )
      }

      // Check if email already exists
      const existingUser = await prisma.user.findUnique({
        where: { email }
      })

      if (existingUser) {
        return NextResponse.json(
          { error: 'Email already exists' },
          { status: 400 }
        )
      }
    }

    // Prepare update data
    const updateData: any = {
      name: finalName,
      email: finalEmail,
      updatedAt: new Date()
    }

    // Handle password change (only for users with existing password)
    if (currentPassword && newPassword && currentUser.password) {
      // Verify current password
      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, currentUser.password)

      if (!isCurrentPasswordValid) {
        return NextResponse.json(
          { error: 'Current password is incorrect' },
          { status: 400 }
        )
      }

      // Validate new password
      if (newPassword.length < 6) {
        return NextResponse.json(
          { error: 'New password must be at least 6 characters' },
          { status: 400 }
        )
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 12)
      updateData.password = hashedPassword
    }

    // Update user in database
    await prisma.user.update({
      where: { id: session.user.id },
      data: updateData
    })

    // Update settings if provided
    if (timezone || locale || timeFormat) {
      await prisma.settings.upsert({
        where: { id: session.user.id },
        update: {
          ...(timezone && { timezone }),
          ...(locale && { locale }),
          ...(timeFormat && { time_format: timeFormat }),
          updatedAt: new Date()
        },
        create: {
          id: session.user.id,
          timezone: timezone || 'Europe/Zurich',
          locale: locale || 'en-US',
          time_format: timeFormat || 'DD.MM.YYYY HH:mm'
        }
      })
    }

    const billingPatch: { companyName?: string | null; phone?: string | null; companyCountry?: string | null } = {}
    if (companyName !== undefined) billingPatch.companyName = String(companyName).trim().slice(0, 200) || null
    if (phone !== undefined) billingPatch.phone = String(phone).trim().slice(0, 40) || null
    if (country !== undefined) billingPatch.companyCountry = String(country).trim().slice(0, 100) || null
    if (Object.keys(billingPatch).length > 0) {
      await prisma.billingInfo.upsert({
        where: { id: session.user.id },
        update: billingPatch,
        create: { id: session.user.id, ...billingPatch }
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Profile updated successfully'
    })

  } catch (error) {
    console.error('Error updating user profile:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}