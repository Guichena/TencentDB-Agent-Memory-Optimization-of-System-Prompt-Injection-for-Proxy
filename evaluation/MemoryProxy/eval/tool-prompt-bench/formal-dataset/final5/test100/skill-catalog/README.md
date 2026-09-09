8 条 **id/name 固定**（case_id 抽签）。
**description 现取**：final5/teams 全量 assets，test100/teams 覆盖已改的队。
改任何一队 assets 后重跑本脚本，邻居队 listing 会跟上，可并行改 39 队。
python test100/sync_listing_from_assets.py
