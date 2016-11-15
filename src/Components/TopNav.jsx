import React from 'react';

import FlatButton from 'material-ui/FlatButton';
import {Toolbar, ToolbarGroup, ToolbarSeparator, ToolbarTitle} from 'material-ui/Toolbar';

export default class TopNav extends React.Component {

    constructor(props) {
        super(props);
        this.state = {
            value: 3,
        };
    }

    handleChange(event, index, value) {
        this.setState({value});
    }

    render() {
        return (
            <Toolbar>
                <ToolbarGroup firstChild={true}>

                    <h3> Logo? </h3>
                </ToolbarGroup>
                <ToolbarGroup>
                    <ToolbarTitle text="Options" />
                    <ToolbarSeparator />
                    <FlatButton label="About" primary={true} />
                    <FlatButton label="Projects" primary={true} />
                    <FlatButton label="Contact" primary={true} />
                </ToolbarGroup>
            </Toolbar>
        );
    }
}