use zcash_client_backend::proto::service::{
    compact_tx_streamer_client::CompactTxStreamerClient,
    BlockId,
    ChainSpec,
    TreeState,
};

pub async fn get_latest_block_height(
    endpoint: &str,
) -> Result<u64, String> {
    let mut client = CompactTxStreamerClient::connect(
        endpoint.to_string(),
    )
    .await
    .map_err(|e| {
        format!(
            "Failed to connect to lightwalletd at {endpoint}: {e}"
        )
    })?;

    let response = client
        .get_latest_block(ChainSpec::default())
        .await
        .map_err(|e| {
            format!("lightwalletd GetLatestBlock failed: {e}")
        })?;

    Ok(response.into_inner().height)
}

pub async fn get_birthday_tree_state(
    endpoint: &str,
) -> Result<(u64, TreeState), String> {
    let mut client = CompactTxStreamerClient::connect(
        endpoint.to_string(),
    )
    .await
    .map_err(|e| {
        format!(
            "Failed to connect to lightwalletd at {endpoint}: {e}"
        )
    })?;

    let tip = client
        .get_latest_block(ChainSpec::default())
        .await
        .map_err(|e| {
            format!("lightwalletd GetLatestBlock failed: {e}")
        })?
        .into_inner()
        .height;

    let birthday_tree_height = tip
        .checked_sub(100)
        .ok_or_else(|| {
            "Chain height is too low to subtract 100 blocks".to_string()
        })?;

    let tree_state = client
        .get_tree_state(BlockId {
            height: birthday_tree_height,
            hash: Vec::new(),
        })
        .await
        .map_err(|e| {
            format!(
                "lightwalletd GetTreeState failed at height \
                 {birthday_tree_height}: {e}"
            )
        })?
        .into_inner();

    Ok((tip, tree_state))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn lightwalletd_reachable() {
        let endpoint = std::env::var("LIGHTWALLETD_URL")
            .unwrap_or_else(|_| {
                "http://127.0.0.1:9067".to_string()
            });

        let (tip, tree_state) = get_birthday_tree_state(&endpoint)
            .await
            .expect("Could not get lightwalletd chain state");

        println!("Lightwalletd connected");
        println!("Chain tip used: {tip}");
        println!(
            "Birthday TreeState height: {}",
            tree_state.height
        );
        println!("Network: {}", tree_state.network);

        assert_eq!(
            tree_state.height + 100,
            tip,
            "TreeState should be exactly 100 blocks behind the tip used"
        );
    }
}

pub async fn get_tree_state_at_height(
    endpoint: &str,
    height: u64,
) -> Result<TreeState, String> {
    let mut client = CompactTxStreamerClient::connect(
        endpoint.to_string(),
    )
    .await
    .map_err(|e| {
        format!(
            "Failed to connect to lightwalletd at {endpoint}: {e}"
        )
    })?;

    client
        .get_tree_state(BlockId {
            height,
            hash: Vec::new(),
        })
        .await
        .map_err(|e| {
            format!(
                "lightwalletd GetTreeState failed at height {height}: {e}"
            )
        })
        .map(|response| response.into_inner())
}
