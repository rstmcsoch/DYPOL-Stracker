import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';

/// Android launch screen. No timer, no fake progress: the real logo is centred on the
/// palette's paper colour with "DYPOL LABS" near the bottom while the session is restored.
/// The native launch frame draws the same logo and name in the same places, so there is no
/// flash or jump when Flutter takes over.
class SplashPage extends StatelessWidget {
  const SplashPage({super.key, this.progress});

  /// Optional real progress (0…1) while data loads. Never used as a delay.
  final double? progress;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final double bottomInset = MediaQuery.paddingOf(context).bottom;
    // Text below the logo, mirrored by an equal gap above it so the logo sits at the exact
    // centre of the screen, where Android's own splash drew it a moment earlier.
    final double below = 18 + 46 + (progress != null ? 29 : 0);
    return Scaffold(
      backgroundColor: colors.palette.bg,
      body: Stack(
        children: <Widget>[
          Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                SizedBox(height: below),
                // The real logo without its tile, the same mark and size (128 dp tall) as
                // the native launch frame, so the hand-off has no jump.
                Image.asset(
                  'assets/brand/logo-mark.png',
                  height: 128,
                  filterQuality: FilterQuality.high,
                  semanticLabel: 'Stracker',
                ),
                const SizedBox(height: 18),
                SizedBox(
                  height: 46,
                  child: Text(
                    'Stracker',
                    style: TextStyle(
                      fontFamily: 'PatrickHand',
                      fontSize: 42,
                      height: 1,
                      color: colors.palette.ink,
                    ),
                  ),
                ),
                if (progress != null) ...<Widget>[
                  const SizedBox(height: 26),
                  SizedBox(
                    width: 120,
                    child: LinearProgressIndicator(
                      value: progress == 0 ? null : progress,
                      minHeight: 3,
                      backgroundColor: colors.palette.ringTrack,
                    ),
                  ),
                ],
              ],
            ),
          ),
          Positioned(
            left: 20,
            right: 20,
            bottom: 24 + bottomInset,
            child: Text(
              'DYPOL LABS',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontFamily: 'Lexend',
                fontSize: 13,
                letterSpacing: 3.2,
                fontWeight: FontWeight.w600,
                color: colors.palette.inkSoft,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
