import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';

/// Android launch screen. No timer, no fake progress: the logo sits on the palette's paper
/// colour, the brand is centred, and the credits sit near the bottom while the session is
/// restored. The native launch theme fades into this same layout, so there is no flash.
class SplashPage extends StatelessWidget {
  const SplashPage({super.key, this.progress});

  /// Optional real progress (0…1) while data loads. Never used as a delay.
  final double? progress;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final double bottomInset = MediaQuery.paddingOf(context).bottom;
    return Scaffold(
      backgroundColor: colors.palette.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: <Widget>[
            Expanded(
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    ClipRRect(
                      borderRadius: BorderRadius.circular(26),
                      child: Image.asset(
                        'assets/brand/logo-adaptive.png',
                        width: 116,
                        height: 116,
                        filterQuality: FilterQuality.high,
                      ),
                    ),
                    const SizedBox(height: 18),
                    Text(
                      'Stracker',
                      style: TextStyle(
                        fontFamily: 'PatrickHand',
                        fontSize: 42,
                        height: 1,
                        color: colors.palette.ink,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'DYPOL LABS',
                      style: TextStyle(
                        fontFamily: 'Lexend',
                        fontSize: 11,
                        letterSpacing: 3.2,
                        fontWeight: FontWeight.w600,
                        color: colors.palette.muted,
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
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(20, 12, 20, 18 + bottomInset),
              child: Column(
                children: <Widget>[
                  Text(
                    'DYPOL LABS',
                    style: TextStyle(
                      fontFamily: 'Lexend',
                      fontSize: 10,
                      letterSpacing: 2.4,
                      fontWeight: FontWeight.w600,
                      color: colors.palette.inkSoft,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    'by Rustam Chaturvedi',
                    style: TextStyle(
                      fontFamily: 'Lexend',
                      fontSize: 9.5,
                      letterSpacing: 0.4,
                      color: colors.palette.muted,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
