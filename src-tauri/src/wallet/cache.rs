use async_trait::async_trait;

use std::{
    error::Error,
    fmt,
    sync::{Mutex, MutexGuard},
};

use zcash_client_backend::{
    data_api::{
        chain::{error, BlockCache, BlockSource},
        scanning::ScanRange,
    },
    proto::compact_formats::CompactBlock,
};
use zcash_protocol::consensus::BlockHeight;

#[derive(Debug)]
pub struct MemoryBlockCacheError(String);

impl fmt::Display for MemoryBlockCacheError {
    fn fmt(
        &self,
        f: &mut fmt::Formatter<'_>,
    ) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl Error for MemoryBlockCacheError {}

#[derive(Debug, Default)]
pub struct MemoryBlockCache {
    blocks: Mutex<Vec<CompactBlock>>,
}

impl MemoryBlockCache {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock_blocks(
        &self,
    ) -> MutexGuard<'_, Vec<CompactBlock>> {
        match self.blocks.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

impl BlockSource for MemoryBlockCache {
    type Error = MemoryBlockCacheError;

    fn with_blocks<F, WalletErrT>(
        &self,
        from_height: Option<BlockHeight>,
        limit: Option<usize>,
        mut with_block: F,
    ) -> Result<(), error::Error<WalletErrT, Self::Error>>
    where
        F: FnMut(
            CompactBlock,
        ) -> Result<
            (),
            error::Error<WalletErrT, Self::Error>,
        >,
    {
        let blocks = self.lock_blocks();

        let from_height_u64 = from_height
            .map(|height| u32::from(height) as u64);

        let mut selected: Vec<CompactBlock> = blocks
            .iter()
            .filter(|block| {
                from_height_u64
                    .map(|height| block.height >= height)
                    .unwrap_or(true)
            })
            .cloned()
            .collect();

        selected.sort_by_key(|block| block.height);

        if let Some(limit) = limit {
            selected.truncate(limit);
        }

        drop(blocks);

        for block in selected {
            with_block(block)?;
        }

        Ok(())
    }
}

#[async_trait]
impl BlockCache for MemoryBlockCache {
    fn get_tip_height(
        &self,
        range: Option<&ScanRange>,
    ) -> Result<Option<BlockHeight>, Self::Error> {
        let blocks = self.lock_blocks();

        let highest = blocks
            .iter()
            .filter(|block| {
                let height =
                    BlockHeight::from_u32(block.height as u32);

                range
                    .map(|range| {
                        range.block_range().contains(&height)
                    })
                    .unwrap_or(true)
            })
            .max_by_key(|block| block.height);

        Ok(highest.map(|block| {
            BlockHeight::from_u32(block.height as u32)
        }))
    }

    async fn read(
        &self,
        range: &ScanRange,
    ) -> Result<Vec<CompactBlock>, Self::Error> {
        let blocks = self.lock_blocks();

        let mut selected: Vec<CompactBlock> = blocks
            .iter()
            .filter(|block| {
                let height =
                    BlockHeight::from_u32(block.height as u32);

                range.block_range().contains(&height)
            })
            .cloned()
            .collect();

        selected.sort_by_key(|block| block.height);

        let expected_start =
            u32::from(range.block_range().start) as u64;

        if let Some(first) = selected.first() {
            if first.height != expected_start {
                return Err(MemoryBlockCacheError(
                    format!(
                        "Compact-block cache starts at {}, expected {}",
                        first.height,
                        expected_start,
                    ),
                ));
            }
        }

        // Short reads are permitted, but everything returned
        // must be contiguous.
        let mut contiguous = Vec::new();
        let mut expected = expected_start;

        for block in selected {
            if block.height != expected {
                break;
            }

            expected = expected
                .checked_add(1)
                .ok_or_else(|| {
                    MemoryBlockCacheError(
                        "Compact-block height overflow".to_string(),
                    )
                })?;

            contiguous.push(block);
        }

        Ok(contiguous)
    }

    async fn insert(
        &self,
        compact_blocks: Vec<CompactBlock>,
    ) -> Result<(), Self::Error> {
        let mut blocks = self.lock_blocks();

        for block in compact_blocks {
            if let Some(existing) = blocks
                .iter_mut()
                .find(|existing| {
                    existing.height == block.height
                })
            {
                *existing = block;
            } else {
                blocks.push(block);
            }
        }

        blocks.sort_by_key(|block| block.height);

        Ok(())
    }

    async fn delete(
        &self,
        range: ScanRange,
    ) -> Result<(), Self::Error> {
        let mut blocks = self.lock_blocks();

        blocks.retain(|block| {
            let height =
                BlockHeight::from_u32(block.height as u32);

            !range.block_range().contains(&height)
        });

        Ok(())
    }
}
