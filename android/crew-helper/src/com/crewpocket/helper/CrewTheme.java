package com.crewpocket.helper;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;

/**
 * Crew Pocket Design System & Theme Tokens for Android Native Helper
 * Unified Cyberpunk Dark Luxury Aesthetic
 */
public final class CrewTheme {
    private CrewTheme() {}

    // 🌌 Deep Backgrounds (Slate 950 / 900 / 800)
    public static final int BG_PRIMARY     = 0xFF020617; // Slate 950
    public static final int BG_SURFACE     = 0xFF0F172A; // Slate 900
    public static final int BG_ELEVATED    = 0xFF1E293B; // Slate 800
    public static final int BG_CARD        = 0xF00F172A; // Translucent Surface

    // 🎨 Brand Accent Colors
    public static final int INDIGO_600     = 0xFF4F46E5;
    public static final int INDIGO_500     = 0xFF6366F1;
    public static final int INDIGO_400     = 0xFF818CF8;
    public static final int TEAL_500       = 0xFF14B8A6;
    public static final int TEAL_400       = 0xFF2DD4BF;
    public static final int TEAL_300       = 0xFF5EEAD4;
    public static final int CYAN_400       = 0xFF22D3EE;

    // 💡 Status Indicators
    public static final int EMERALD_500    = 0xFF10B981;
    public static final int EMERALD_400    = 0xFF34D399;
    public static final int ROSE_500       = 0xFFF43F5E;
    public static final int ROSE_400       = 0xFFFB7185;
    public static final int AMBER_500      = 0xFFF59E0B;
    public static final int AMBER_400      = 0xFFFBBF24;

    // 🔤 Typography & Content Colors
    public static final int TEXT_PRIMARY   = 0xFFF8FAFC; // Slate 50
    public static final int TEXT_SECONDARY = 0xFF94A3B8; // Slate 400
    public static final int TEXT_MUTED     = 0xFF64748B; // Slate 500
    public static final int TEXT_DISABLED  = 0xFF475569; // Slate 600

    // 🔲 Borders
    public static final int BORDER_SUBTLE  = 0xFF334155; // Slate 700
    public static final int BORDER_INDIGO  = 0x33818CF8; // Indigo 400 @ 20%
    public static final int BORDER_TEAL    = 0x332DD4BF; // Teal 400 @ 20%

    /** Convert DP to pixels */
    public static int dp(Context ctx, float value) {
        if (ctx == null) return (int) value;
        return (int) (value * ctx.getResources().getDisplayMetrics().density + 0.5f);
    }

    /** Create a luxury rounded surface card drawable */
    public static GradientDrawable createCard(Context ctx, int bgColor, int borderColor, float radiusDp) {
        GradientDrawable gd = new GradientDrawable();
        gd.setColor(bgColor);
        gd.setCornerRadius(dp(ctx, radiusDp));
        if (borderColor != Color.TRANSPARENT) {
            gd.setStroke(dp(ctx, 1f), borderColor);
        }
        return gd;
    }

    /** Create a linear gradient button drawable */
    public static GradientDrawable createGradientButton(Context ctx, int startColor, int endColor, float radiusDp) {
        GradientDrawable gd = new GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            new int[]{ startColor, endColor }
        );
        gd.setCornerRadius(dp(ctx, radiusDp));
        return gd;
    }

    /** Create an icon container badge */
    public static GradientDrawable createIconBadge(Context ctx, int tintColor, float radiusDp) {
        GradientDrawable gd = new GradientDrawable();
        gd.setColor(Color.argb(45, Color.red(tintColor), Color.green(tintColor), Color.blue(tintColor)));
        gd.setCornerRadius(dp(ctx, radiusDp));
        gd.setStroke(dp(ctx, 1f), Color.argb(90, Color.red(tintColor), Color.green(tintColor), Color.blue(tintColor)));
        return gd;
    }
}
