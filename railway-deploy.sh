#!/bin/bash
# Script para redesplegar en Railway
railway up --detach --service $(railway service list 2>/dev/null | grep -v "Service" | head -1 | awk '{print $1}')
