import React from 'react';
import * as d3 from 'd3';

import Tree from './Tree';
export default class ActiveBackgound extends React.Component {

    constructor(props) {
        super(props);
        this.state =  {
            data:{
                "name": "Top Level",
                "value": 10,
                "type": "black",
                "level": "red",
                "children": [
                    {
                        "name": "Level 2: A",
                        "value": 15,
                        "type": "grey",
                        "level": "red",
                        "children": [
                            {
                                "name": "Son of A",
                                "value": 5,
                                "type": "steelblue",
                                "level": "orange",
                                "children": [
                                    {
                                        "name": "Level 2: A",
                                        "value": 15,
                                        "type": "grey",
                                        "level": "red",
                                    },
                                    {
                                        "name": "Level 2: A",
                                        "value": 15,
                                        "type": "grey",
                                        "level": "red",
                                    }
                                ]
                            },
                            {
                                "name": "Daughter of A",
                                "value": 8,
                                "type": "steelblue",
                                "level": "red",
                                "children": [
                                    {
                                        "name": "Level 2: A",
                                        "value": 15,
                                        "type": "grey",
                                        "level": "red",
                                    },
                                    {
                                        "name": "Level 2: A",
                                        "value": 15,
                                        "type": "grey",
                                        "level": "red",
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        "name": "Level 2: B",
                        "value": 10,
                        "type": "grey",
                        "level": "green",
                        "children": [
                            {
                                "name": "Son of A",
                                "value": 5,
                                "type": "steelblue",
                                "level": "orange",
                                "children": [
                                    {
                                        "name": "Level 2: A",
                                        "value": 15,
                                        "type": "grey",
                                        "level": "red",
                                    },
                                    {
                                        "name": "Level 2: A",
                                        "value": 15,
                                        "type": "grey",
                                        "level": "red",
                                    }
                                ]
                            },
                            {
                                "name": "Daughter of A",
                                "value": 8,
                                "type": "steelblue",
                                "level": "red",
                                "children": [
                                    {
                                        "name": "Level 2: A",
                                        "value": 15,
                                        "type": "grey",
                                        "level": "red",
                                    },
                                    {
                                        "name": "Level 2: A",
                                        "value": 15,
                                        "type": "grey",
                                        "level": "red",
                                    }
                                ]
                            }
                        ]
                    }
                ]
            }
        };
    }
    addLayer(){

    }
    render() {
        let margin = {top: 20, right: 90, bottom: 30, left: 90},
            width = 400 - margin.left - margin.right,
            height = 800 - margin.top - margin.bottom;

// declares a tree layout and assigns the size
        let treemap = d3.tree()
            .size([height, width]);

//  assigns the data to a hierarchy using parent-child relationships
        let nodes = d3.hierarchy(this.state.data, function(d) {
            return d.children;
        });

        nodes = treemap(nodes);


        let data = nodes;
        console.log(nodes);
        var transform= 'translate(' + margin.left + ',' + margin.top + ')';
        return (
            <svg className="journey" viewBox={"0 0 " + height + " " + width} id={'chart'} width={width} height={height}>
                    <Tree data={data}/>
            </svg>
        );
    }
}
