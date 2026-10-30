# TSB ダメージ計算

[TheSkyBlessing](https://github.com/ProjectTSB/TheSkyBlessing)（TSB）の `api:damage` が 1 回のダメージをどう計算するかを、段ごとの値で確かめる開発者向けのツールです。計算は TSB の master（2026 年 10 月 19 日時点）に合わせています。

![攻撃・防御の入力と、段ごとの計算結果が並んだ画面](docs/screenshot.png)

## ダウンロード

[Releases](https://github.com/ProjectTSB/tsb-damage-calc/releases) から `tsb-damage-calc.exe` をダウンロードして起動します。Windows 10・11 で動きます。

- 署名していない exe なので、初回起動時に SmartScreen の警告が出ることがあります。

## 計算の範囲

`api:damage/modifier` から、`api:damage/` が体力を減らす量までを、ゲーム内と同じく整数で計算します。float への丸め、`data get` の切り捨て、scoreboard の割り算の丸めも同じ順に再現しています。

- `Damage` と `Resist` の「型」は TSB のコードでの書き方（`30f` なら float）に合わせて選びます。float では丸めが入るので、0.7f は 0.69 として計算されます。
- 計算モード「上限 99999.9」は [PR #1635](https://github.com/ProjectTSB/TheSkyBlessing/pull/1635) の計算です。

## 計算しないもの

最終ダメージは体力で止める前の 1 回分の値です。

- 緩衝体力の消費と、残りの体力は計算しません。
- 装備を複数持ったときの重ね掛け（`MaxStack`・`StackReduction`）は計算しません。バフの値に合計を入れます。

## ビルド

Node.js 24 以上、pnpm、Rust（rustup）、Microsoft C++ Build Tools（「C++ によるデスクトップ開発」）が要ります。

```sh
pnpm install --frozen-lockfile
pnpm tauri build --no-bundle -- --locked
```

- exe は `src-tauri/target/release/tsb-damage-calc.exe` に出力されます。
