# Security

Do not put API keys, recipient exports, or private message bodies in public issues.

Use the repository's **Security → Report a vulnerability** form when private reporting is available. Otherwise, contact the maintainer through [their GitHub profile](https://github.com/dciccale) to arrange a private report before sharing technical details. Do not open a public exploit report with live credentials or recipient data.

Use the latest published version. Security fixes are maintained on the default branch; older versions have no separate support branch.

The host application must authorize access to component functions and delivery records. Keep provider keys in the host environment. The component defaults to offline test mode. Enable live sending only after checking the sender domain, recipient restrictions, webhook configuration, and recovery procedure.
